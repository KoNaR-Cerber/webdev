#define _DEFAULT_SOURCE
#include "gps_serial.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

typedef struct { int master, mode, queries, enables; } modem_t;
static void *emulate(void *arg) {
  modem_t *modem = arg;
  char line[128]; size_t used = 0;
  for (;;) {
    struct pollfd p = {.fd = modem->master, .events = POLLIN};
    int rc = poll(&p, 1, 5000);
    if (rc <= 0 || p.revents & (POLLHUP | POLLERR | POLLNVAL)) return NULL;
    char ch; ssize_t n = read(modem->master, &ch, 1);
    if (n != 1) return NULL;
    if (ch == '\r') continue;
    if (ch != '\n') { assert(used + 1 < sizeof(line)); line[used++] = ch; continue; }
    line[used] = 0; used = 0;
    const char *response = NULL;
    if (!strcmp(line, "AT+QGPS?")) {
      ++modem->queries;
      if (modem->mode == 3) continue;
      if (modem->mode == 2) response = "\r\nERROR\r\n";
      else if (modem->mode == 1 && !modem->enables) response = "\r\n+QGPS: 0\r\nOK\r\n";
      else response = "\r\n+QGPS: 1\r\nOK\r\n";
    } else {
      assert(!strcmp(line, "AT+QGPS=1")); assert(modem->mode == 1);
      ++modem->enables; response = "\r\nOK\r\n";
    }
    assert(write(modem->master, response, strlen(response)) == (ssize_t)strlen(response));
  }
}

int main(void) {
  for (int mode = 0; mode < 4; ++mode) {
    int master, original; char path[128]; struct termios before, after;
    assert(openpty(&master, &original, path, NULL, NULL) == 0);
    assert(tcgetattr(original, &before) == 0); close(original);
    gps_serial_t port = {.fd = -1};
    assert(gps_serial_open(&port, path) == 0);
    gps_serial_t conflicting = {.fd = -1};
    assert(gps_serial_open(&conflicting, path) != 0);
    modem_t modem = {.master = master, .mode = mode}; pthread_t thread;
    assert(pthread_create(&thread, NULL, emulate, &modem) == 0);
    double started = gps_monotonic();
    int rc = gps_serial_enable_gnss(&port);
    assert((mode < 2 && rc == 0) || (mode >= 2 && rc != 0));
    if (mode == 3) assert(gps_monotonic() - started >= 2.5 && gps_monotonic() - started < 5);
    gps_serial_close(&port);
    assert(pthread_join(thread, NULL) == 0);
    int reopened = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK);
    assert(reopened >= 0); assert(tcgetattr(reopened, &after) == 0);
    assert(before.c_iflag == after.c_iflag && before.c_oflag == after.c_oflag &&
           before.c_cflag == after.c_cflag && before.c_lflag == after.c_lflag);
    assert(cfgetispeed(&before) == cfgetispeed(&after));
    close(reopened); close(master);
    assert(modem.queries == (mode == 1 ? 2 : 1));
    assert(modem.enables == (mode == 1 ? 1 : 0));
  }
  puts("serial PTY tests passed: query, conditional enable, error, timeout, locking, termios restore");
  return 0;
}
