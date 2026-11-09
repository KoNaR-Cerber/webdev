/* Serial handling adapted from Interp4GPSComm/gps_com.c by Michał Sadecki,
 * 2026. Runtime configuration, locking, deadlines and response validation added. */
#define _DEFAULT_SOURCE
#include "gps_serial.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

double gps_monotonic(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return 0;
  return t.tv_sec + t.tv_nsec / 1000000000.0;
}

void gps_serial_close(gps_serial_t *port) {
  if (port->fd < 0) return;
  if (port->saved_valid) (void)tcsetattr(port->fd, TCSANOW, &port->saved);
  (void)ioctl(port->fd, TIOCNXCL);
  (void)flock(port->fd, LOCK_UN);
  close(port->fd);
  port->fd = -1;
  port->saved_valid = 0;
}

int gps_serial_open(gps_serial_t *port, const char *path) {
  port->fd = -1; port->saved_valid = 0;
  int fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISCHR(st.st_mode)) {
    close(fd); errno = ENOTTY; return -1;
  }
  if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return -1; }
  if (ioctl(fd, TIOCEXCL) != 0) { close(fd); return -1; }
  port->fd = fd;
  if (tcgetattr(fd, &port->saved) != 0) { gps_serial_close(port); return -1; }
  port->saved_valid = 1;
  struct termios raw = port->saved;
  cfmakeraw(&raw);
  cfsetispeed(&raw, B115200); cfsetospeed(&raw, B115200);
  raw.c_cflag |= CLOCAL | CREAD;
#ifdef CRTSCTS
  raw.c_cflag &= ~CRTSCTS;
#endif
  raw.c_cc[VMIN] = 0; raw.c_cc[VTIME] = 0;
  if (tcsetattr(fd, TCSANOW, &raw) != 0) { gps_serial_close(port); return -1; }
  return 0;
}

static int ready(int fd, short events, double deadline) {
  for (;;) {
    double remaining = deadline - gps_monotonic();
    if (remaining <= 0) { errno = ETIMEDOUT; return -1; }
    struct pollfd p = {.fd = fd, .events = events};
    int rc = poll(&p, 1, (int)(remaining * 1000) + 1);
    if (rc < 0 && errno == EINTR) continue;
    if (rc <= 0) { if (rc == 0) errno = ETIMEDOUT; return -1; }
    if (p.revents & (POLLERR | POLLHUP | POLLNVAL)) { errno = ENODEV; return -1; }
    if (p.revents & events) return 0;
  }
}

static int command(gps_serial_t *port, const char *cmd, char *response, size_t cap) {
  double deadline = gps_monotonic() + 3.0;
  size_t sent = 0, len = strlen(cmd), used = 0;
  response[0] = 0;
  while (sent < len) {
    if (ready(port->fd, POLLOUT, deadline) != 0) return -1;
    ssize_t n = write(port->fd, cmd + sent, len - sent);
    if (n > 0) sent += (size_t)n;
    else if (n < 0 && errno != EAGAIN && errno != EINTR) return -1;
  }
  while (used + 1 < cap) {
    if (ready(port->fd, POLLIN, deadline) != 0) return -1;
    ssize_t n = read(port->fd, response + used, cap - used - 1);
    if (n < 0) { if (errno == EAGAIN || errno == EINTR) continue; return -1; }
    if (n == 0) continue;
    used += (size_t)n; response[used] = 0;
    if (strstr(response, "\nERROR") || strstr(response, "+CME ERROR")) {
      errno = EPROTO; return -1;
    }
    if (strstr(response, "\nOK\r") || strstr(response, "\nOK\n")) return 0;
  }
  errno = EMSGSIZE; return -1;
}

int gps_serial_enable_gnss(gps_serial_t *port) {
  char response[2048];
  /* Discard prior unsolicited text, not another process's response: the port
   * must have no existing holders before this program starts. */
  if (tcflush(port->fd, TCIFLUSH) != 0) return -1;
  if (command(port, "AT+QGPS?\r\n", response, sizeof(response)) != 0) return -1;
  const char *state = strstr(response, "+QGPS:");
  int enabled = -1;
  if (!state || sscanf(state, "+QGPS: %d", &enabled) != 1 || enabled < 0 || enabled > 1) {
    errno = EPROTO; return -1;
  }
  if (enabled == 1) return 0;
  if (command(port, "AT+QGPS=1\r\n", response, sizeof(response)) != 0) return -1;
  if (command(port, "AT+QGPS?\r\n", response, sizeof(response)) != 0) return -1;
  state = strstr(response, "+QGPS:");
  if (!state || sscanf(state, "+QGPS: %d", &enabled) != 1 || enabled != 1) {
    errno = EPROTO; return -1;
  }
  return 0;
}
