#ifndef CERBER_GPS_SERIAL_H
#define CERBER_GPS_SERIAL_H
#include <stddef.h>
#include <termios.h>
typedef struct { int fd; int saved_valid; struct termios saved; } gps_serial_t;
double gps_monotonic(void);
int gps_serial_open(gps_serial_t *port, const char *path);
void gps_serial_close(gps_serial_t *port);
/* Return 0 on success, -1 on failure. Only QGPS? and QGPS=1 are sent. */
int gps_serial_enable_gnss(gps_serial_t *port);
#endif
