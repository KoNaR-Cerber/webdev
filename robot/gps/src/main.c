/* GPS publisher derived from Interp4GPSComm by Michał Sadecki (2026).
 * Uses the original minmea parser lineage; no robot movement or LTE commands. */
#define _DEFAULT_SOURCE
#include "gps_parser.h"
#include "gps_serial.h"
#include <arpa/inet.h>
#include <errno.h>
#include <mosquitto.h>
#include <poll.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  const char *nmea, *at, *host, *bind_address, *topic, *status_topic;
  int port;
} config_t;
typedef struct {
  config_t config;
  struct mosquitto *mqtt;
  atomic_bool connected, lost;
  atomic_uint generation;
  unsigned seen_generation;
  double connecting_at, retry_at;
} mqtt_t;
static volatile sig_atomic_t stopping;
static void stop_handler(int signal_number) { (void)signal_number; stopping = 1; }

static const char *required(const char *name) {
  const char *v = getenv(name);
  if (!v || !*v || strpbrk(v, "\r\n")) {
    fprintf(stderr, "configuration_error field=%s\n", name); return NULL;
  }
  return v;
}
static int config_read(config_t *c) {
  memset(c, 0, sizeof(*c));
  c->nmea = required("GPS_NMEA_DEVICE"); c->at = required("GPS_AT_DEVICE");
  c->host = required("GPS_MQTT_HOST"); c->bind_address = required("GPS_MQTT_BIND_ADDRESS");
  const char *port = required("GPS_MQTT_PORT");
  c->topic = getenv("GPS_MQTT_TOPIC");
  if (!c->topic || !*c->topic) c->topic = "cerber/gps/data";
  c->status_topic = getenv("GPS_MQTT_STATUS_TOPIC");
  if (!c->status_topic || !*c->status_topic) c->status_topic = "cerber/gps/status";
  if (!c->nmea || !c->at || !c->host || !c->bind_address || !port) return -1;
#ifdef GPS_TEST_DEVICES
  /* Only the separate test binary accepts private pseudo-terminals. */
  if (strncmp(c->nmea, "/dev/pts/", 9) || strncmp(c->at, "/dev/pts/", 9) || !strcmp(c->nmea, c->at)) {
    fprintf(stderr, "configuration_error private_PTYs_required\n"); return -1;
  }
#else
  const char *prefix = "/dev/serial/by-id/usb-Quectel_";
  const char *nmea_if = strstr(c->nmea, "-if01-port0");
  const char *at_if = strstr(c->at, "-if03-port0");
  if (strncmp(c->nmea, prefix, strlen(prefix)) || strncmp(c->at, prefix, strlen(prefix)) ||
      !nmea_if || !at_if || strcmp(nmea_if, "-if01-port0") || strcmp(at_if, "-if03-port0") ||
      (nmea_if - c->nmea) != (at_if - c->at) ||
      strncmp(c->nmea, c->at, (size_t)(nmea_if - c->nmea))) {
    fprintf(stderr, "configuration_error dedicated_Quectel_if01_and_if03_required\n"); return -1;
  }
#endif
  char *end = NULL; errno = 0;
  long number = strtol(port, &end, 10);
  if (errno || end == port || *end || number < 1 || number > 65535) {
    fprintf(stderr, "configuration_error field=GPS_MQTT_PORT\n"); return -1;
  }
  c->port = (int)number;
  struct in_addr host, bind_address;
  if (inet_pton(AF_INET, c->host, &host) != 1 ||
      inet_pton(AF_INET, c->bind_address, &bind_address) != 1 ||
      host.s_addr == INADDR_ANY || bind_address.s_addr == INADDR_ANY) {
    fprintf(stderr, "configuration_error explicit_MQTT_IPv4_addresses_required\n"); return -1;
  }
  if (strlen(c->topic) > 128 || strpbrk(c->topic, "#+\r\n")) {
    fprintf(stderr, "configuration_error field=GPS_MQTT_TOPIC\n"); return -1;
  }
  if (strlen(c->status_topic) > 128 || strpbrk(c->status_topic, "#+\r\n") ||
      !strcmp(c->status_topic, c->topic)) {
    fprintf(stderr, "configuration_error field=GPS_MQTT_STATUS_TOPIC\n"); return -1;
  }
  return 0;
}

static void on_connect(struct mosquitto *m, void *userdata, int rc) {
  (void)m; mqtt_t *state = userdata;
  if (rc == 0) {
    atomic_fetch_add(&state->generation, 1);
    atomic_store(&state->connected, true);
  } else atomic_store(&state->lost, true);
}
static void on_disconnect(struct mosquitto *m, void *userdata, int rc) {
  (void)m; (void)rc; mqtt_t *state = userdata;
  atomic_store(&state->connected, false);
  atomic_store(&state->lost, true);
}
static void mqtt_close(mqtt_t *state) {
  atomic_store(&state->connected, false);
  if (state->mqtt) {
    (void)mosquitto_disconnect(state->mqtt);
    (void)mosquitto_loop_stop(state->mqtt, true);
    mosquitto_destroy(state->mqtt);
    state->mqtt = NULL;
  }
}
static void mqtt_tick(mqtt_t *state, gps_parser_t *parser, int nmea_fd, double now) {
  if (state->mqtt && (atomic_load(&state->lost) ||
      (!atomic_load(&state->connected) && now - state->connecting_at > 12))) {
    mqtt_close(state);
    state->retry_at = now + 3;
    fprintf(stderr, "mqtt_disconnected retry_seconds=3\n");
  }
  if (!state->mqtt && now >= state->retry_at) {
    atomic_store(&state->lost, false);
    char client_id[64];
    snprintf(client_id, sizeof(client_id), "cerber-gps-%ld", (long)getpid());
    state->mqtt = mosquitto_new(client_id, true, state);
    if (!state->mqtt) { state->retry_at = now + 3; return; }
    mosquitto_connect_callback_set(state->mqtt, on_connect);
    mosquitto_disconnect_callback_set(state->mqtt, on_disconnect);
    /* Main loop destroys the client on disconnect before this delay elapses.
     * Thus no queued old fix can survive into a reconnected session. */
    mosquitto_reconnect_delay_set(state->mqtt, 30, 30, false);
    state->connecting_at = now;
    int rc = mosquitto_connect_bind_async(state->mqtt, state->config.host,
      state->config.port, 15, state->config.bind_address);
    if (rc == MOSQ_ERR_SUCCESS) rc = mosquitto_loop_start(state->mqtt);
    if (rc != MOSQ_ERR_SUCCESS) {
      mqtt_close(state); state->retry_at = now + 3;
      fprintf(stderr, "mqtt_connect_failed code=%d\n", rc);
    }
  }
  unsigned generation = atomic_load(&state->generation);
  if (generation != state->seen_generation) {
    state->seen_generation = generation;
    uint64_t count = parser->nmea_count;
    gps_parser_init(parser); parser->nmea_count = count;
    (void)tcflush(nmea_fd, TCIFLUSH);
    fprintf(stderr, "mqtt_connected awaiting_fresh_fix\n");
  }
}

int main(int argc, char **argv) {
  if (argc > 2 || (argc == 2 && strcmp(argv[1], "--check-config"))) {
    fprintf(stderr, "usage: robot_gps [--check-config]\n"); return 2;
  }
  config_t config;
  if (config_read(&config) != 0) return 2;
  if (argc == 2) { puts("configuration_valid hardware_opened=false network_started=false"); return 0; }
  struct sigaction action = {0};
  action.sa_handler = stop_handler; sigemptyset(&action.sa_mask);
  sigaction(SIGINT, &action, NULL); sigaction(SIGTERM, &action, NULL);
  signal(SIGPIPE, SIG_IGN);
  gps_serial_t at = {.fd = -1}, nmea = {.fd = -1};
  int result = 1;
  if (gps_serial_open(&at, config.at) != 0) {
    fprintf(stderr, "at_open_failed error=%s\n", strerror(errno)); goto serial_cleanup;
  }
  if (gps_serial_enable_gnss(&at) != 0) {
    fprintf(stderr, "gnss_query_or_enable_failed error=%s\n", strerror(errno)); goto serial_cleanup;
  }
  gps_serial_close(&at);
  fprintf(stderr, "gnss_enabled\n");
  if (stopping) { result = 0; goto serial_cleanup; }
  if (gps_serial_open(&nmea, config.nmea) != 0 || tcflush(nmea.fd, TCIFLUSH) != 0) {
    fprintf(stderr, "nmea_open_failed error=%s\n", strerror(errno)); goto serial_cleanup;
  }
  if (mosquitto_lib_init() != MOSQ_ERR_SUCCESS) goto serial_cleanup;
  mqtt_t mqtt = {.config = config};
  atomic_init(&mqtt.connected, false); atomic_init(&mqtt.lost, false); atomic_init(&mqtt.generation, 0);
  gps_parser_t parser; gps_parser_init(&parser);
  char line[512]; size_t line_len = 0; bool discard = false;
  double last_bytes = gps_monotonic(), report_at = last_bytes, status_at = last_bytes, last_publish = -100;
  unsigned long long published = 0;
  while (!stopping) {
    double now = gps_monotonic();
    unsigned before_generation = mqtt.seen_generation;
    mqtt_tick(&mqtt, &parser, nmea.fd, now);
    if (before_generation != mqtt.seen_generation) { line_len = 0; discard = false; status_at = now; }
    gps_parser_expire(&parser, now);
    if (now - last_bytes > 30) {
      fprintf(stderr, "nmea_silent timeout_seconds=30\n"); break;
    }
    if (now >= report_at) {
      fprintf(stderr, "gps_status fix=%s nmea=%llu satellites=%d mqtt_connected=%s published=%llu\n",
        parser.has_fix ? "valid" : "no_fix", (unsigned long long)parser.nmea_count,
        parser.satellites, atomic_load(&mqtt.connected) ? "true" : "false", published);
      report_at = now + 10;
    }
    /* Receiver status for the API: no coordinates, so it goes out even without a fix.
     * First one right after (re)connecting, then every 5 s. */
    if (now >= status_at) {
      status_at = now + 5;
      if (atomic_load(&mqtt.connected) && !atomic_load(&mqtt.lost) &&
          mqtt.seen_generation == atomic_load(&mqtt.generation)) {
        char status[160];
        int n = snprintf(status, sizeof(status),
          "{\"fix\":%s,\"satellites\":%d,\"nmea_alive\":%s,\"published\":%llu}",
          parser.has_fix ? "true" : "false", parser.satellites,
          now - last_bytes < 5.0 ? "true" : "false", published);
        if (n > 0 && n < (int)sizeof(status)) {
          int sent = mosquitto_publish(mqtt.mqtt, NULL, config.status_topic, n, status, 0, false);
          if (sent != MOSQ_ERR_SUCCESS) fprintf(stderr, "mqtt_status_publish_failed code=%d\n", sent);
        }
      }
    }
    struct pollfd p = {.fd = nmea.fd, .events = POLLIN};
    int rc = poll(&p, 1, 100);
    if (rc < 0) { if (errno == EINTR) continue; perror("nmea_poll_failed"); break; }
    if (p.revents & (POLLERR | POLLHUP | POLLNVAL)) {
      fprintf(stderr, "nmea_device_lost\n"); break;
    }
    if (!(p.revents & POLLIN)) continue;
    char bytes[4096]; ssize_t size = read(nmea.fd, bytes, sizeof(bytes));
    if (size < 0) { if (errno == EAGAIN || errno == EINTR) continue; perror("nmea_read_failed"); break; }
    if (size == 0) continue;
    last_bytes = gps_monotonic();
    for (ssize_t i = 0; i < size; ++i) {
      if (bytes[i] == '\n') {
        if (!discard && line_len) {
          line[line_len] = 0;
          gps_fix_t fix;
          now = gps_monotonic();
          if (gps_parser_feed(&parser, line, now, &fix) &&
              atomic_load(&mqtt.connected) && !atomic_load(&mqtt.lost) &&
              mqtt.seen_generation == atomic_load(&mqtt.generation) && now - last_publish >= 1.0) {
            char *json = gps_fix_json(&fix);
            if (json) {
              int sent = mosquitto_publish(mqtt.mqtt, NULL, config.topic, (int)strlen(json), json, 0, false);
              if (sent == MOSQ_ERR_SUCCESS) { last_publish = now; ++published; }
              else fprintf(stderr, "mqtt_publish_failed code=%d\n", sent);
              free(json);
            }
          }
        }
        line_len = 0; discard = false;
      } else if (!discard) {
        if (line_len + 1 < sizeof(line)) line[line_len++] = bytes[i];
        else { discard = true; line_len = 0; }
      }
    }
  }
  if (stopping) result = 0;
  mqtt_close(&mqtt); mosquitto_lib_cleanup();
serial_cleanup:
  gps_serial_close(&at); gps_serial_close(&nmea);
  fprintf(stderr, "gps_stopped exit_code=%d\n", result);
  return result;
}
