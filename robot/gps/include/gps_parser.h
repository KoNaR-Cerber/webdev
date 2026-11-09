#ifndef CERBER_GPS_PARSER_H
#define CERBER_GPS_PARSER_H

#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#define GPS_FIX_MAX_AGE_SECONDS 2.0

typedef struct {
    double latitude, longitude, altitude;
    int satellites, fix_quality;
    time_t utc;
} gps_fix_t;

/* Concrete storage; fields below the status section are private to the parser. */
typedef struct {
    uint64_t nmea_count;
    int satellites;
    bool has_fix;
    double last_valid_monotonic;

    bool rmc_ready, gga_ready, emitted;
    time_t rmc_utc, emitted_utc;
    int rmc_second_of_day, rmc_microseconds;
    int gga_second_of_day, gga_microseconds, emitted_microseconds;
    double rmc_received, gga_received;
    double rmc_latitude, rmc_longitude;
    gps_fix_t gga;
} gps_parser_t;

void gps_parser_init(gps_parser_t *parser);
/* Call periodically even if no NMEA bytes arrive. Does not reset counters. */
void gps_parser_expire(gps_parser_t *parser, double monotonic_now);
/* 1: a new complete fix in out; 0: ignored, invalid, stale or incomplete input.
 * Requires checksummed RMC and GGA with identical UTC time (including fraction),
 * each received within two seconds. UTC date always comes from that RMC.
 * Coordinates must agree within 0.0001 degrees; no missing value is substituted.
 * The same or an older UTC epoch is never emitted twice during a parser lifetime.
 */
int gps_parser_feed(gps_parser_t *parser, const char *line,
                    double monotonic_now, gps_fix_t *out);
/* Caller owns returned memory and releases it with free(); NULL if invalid/OOM. */
char *gps_fix_json(const gps_fix_t *fix);

#endif
