/* GPS receive/JSON path derived from Cerber Interp4GPSComm (2026).
 * NMEA parsing uses Kosma Moczek's minmea, preserving its license in lib/.
 * This implementation keeps UTC, pairs complete epochs, and fails closed.
 */
#include "gps_parser.h"
#include "minmea.h"
#include <cJSON.h>

#include <math.h>
#include <stdlib.h>
#include <string.h>

static void invalidate(gps_parser_t *p) {
    p->rmc_ready = false;
    p->gga_ready = false;
    p->has_fix = false;
}

void gps_parser_init(gps_parser_t *p) {
    if (p) memset(p, 0, sizeof(*p));
}

void gps_parser_expire(gps_parser_t *p, double now) {
    if (!p) return;
    if (!isfinite(now)) { invalidate(p); return; }
    if (p->rmc_ready && (now < p->rmc_received || now - p->rmc_received > GPS_FIX_MAX_AGE_SECONDS))
        p->rmc_ready = false;
    if (p->gga_ready && (now < p->gga_received || now - p->gga_received > GPS_FIX_MAX_AGE_SECONDS))
        p->gga_ready = false;
    if (p->has_fix && (now < p->last_valid_monotonic || now - p->last_valid_monotonic > GPS_FIX_MAX_AGE_SECONDS))
        p->has_fix = false;
}

static bool time_valid(const struct minmea_time *t) {
    return t->hours >= 0 && t->hours < 24 && t->minutes >= 0 && t->minutes < 60 &&
           t->seconds >= 0 && t->seconds < 60 && t->microseconds >= 0 && t->microseconds < 1000000;
}

static int second_of_day(const struct minmea_time *t) {
    return t->hours * 3600 + t->minutes * 60 + t->seconds;
}

static bool utc_time(const struct minmea_date *date, const struct minmea_time *clock, time_t *out) {
    if (!time_valid(clock) || date->year < 0 || date->month < 1 || date->month > 12 ||
        date->day < 1 || date->day > 31) return false;
    struct tm calendar, roundtrip;
    if (minmea_getdatetime(&calendar, date, clock) != 0) return false;
    const int year = calendar.tm_year, month = calendar.tm_mon, day = calendar.tm_mday;
    calendar.tm_isdst = 0;
    const time_t value = timegm(&calendar);
    if (value == (time_t)-1 || !gmtime_r(&value, &roundtrip) ||
        roundtrip.tm_year != year || roundtrip.tm_mon != month || roundtrip.tm_mday != day ||
        roundtrip.tm_hour != clock->hours || roundtrip.tm_min != clock->minutes ||
        roundtrip.tm_sec != clock->seconds) return false;
    *out = value;
    return true;
}

/* minmea accepts any cardinal direction in either position. Also reject empty
 * direction fields, which would otherwise multiply a coordinate by zero. */
static bool direction(const char *line, int wanted, char a, char b) {
    const char *field = line;
    for (int i = 0; i < wanted; ++i) {
        field = strchr(field, ',');
        if (!field) return false;
        ++field;
    }
    return (field[0] == a || field[0] == b) && field[1] == ',';
}

static bool coordinate(struct minmea_float raw, double limit, double *out) {
    if (raw.scale <= 0) return false;
    const double value = fabs((double)raw.value / raw.scale);
    const double degrees = floor(value / 100.0), minutes = value - degrees * 100.0;
    if (!isfinite(value) || minutes >= 60.0 || degrees > limit ||
        (degrees == limit && minutes != 0.0)) return false;
    *out = (degrees + minutes / 60.0) * (raw.value < 0 ? -1.0 : 1.0);
    return isfinite(*out) && fabs(*out) <= limit;
}

static bool useful_fix(const gps_fix_t *f) {
    return f && isfinite(f->latitude) && fabs(f->latitude) <= 90.0 &&
           isfinite(f->longitude) && fabs(f->longitude) <= 180.0 && isfinite(f->altitude) &&
           f->satellites > 0 && f->satellites <= 255 && f->fix_quality >= 1 && f->fix_quality <= 5;
}

int gps_parser_feed(gps_parser_t *p, const char *line, double now, gps_fix_t *out) {
    if (!p || !line || !out) return 0;
    gps_parser_expire(p, now);
    if (!isfinite(now) || strlen(line) > 255) return 0;
    const bool relevant = strlen(line) >= 6 && line[0] == '$' &&
                         (!memcmp(line + 3, "RMC", 3) || !memcmp(line + 3, "GGA", 3));
    if (!minmea_check(line, true)) {
        if (relevant) invalidate(p);
        return 0;
    }
    ++p->nmea_count;
    const enum minmea_sentence_id type = minmea_sentence_id(line, true);
    if (type == MINMEA_SENTENCE_RMC) {
        struct minmea_sentence_rmc rmc;
        memset(&rmc, 0, sizeof(rmc));
        time_t utc;
        double latitude, longitude;
        if (!minmea_parse_rmc(&rmc, line) || !rmc.valid ||
            !direction(line, 4, 'N', 'S') || !direction(line, 6, 'E', 'W') ||
            !utc_time(&rmc.date, &rmc.time, &utc) ||
            !coordinate(rmc.latitude, 90, &latitude) || !coordinate(rmc.longitude, 180, &longitude)) {
            invalidate(p); return 0;
        }
        p->rmc_utc = utc;
        p->rmc_second_of_day = second_of_day(&rmc.time);
        p->rmc_microseconds = rmc.time.microseconds;
        p->rmc_latitude = latitude;
        p->rmc_longitude = longitude;
        p->rmc_received = now;
        p->rmc_ready = true;
    } else if (type == MINMEA_SENTENCE_GGA) {
        struct minmea_sentence_gga gga;
        memset(&gga, 0, sizeof(gga));
        if (!minmea_parse_gga(&gga, line)) { invalidate(p); return 0; }
        p->satellites = (gga.satellites_tracked >= 0 && gga.satellites_tracked <= 255)
            ? gga.satellites_tracked : 0;
        gps_fix_t fix = { .satellites = gga.satellites_tracked, .fix_quality = gga.fix_quality };
        if (!time_valid(&gga.time) || gga.fix_quality < 1 || gga.fix_quality > 5 ||
            !direction(line, 3, 'N', 'S') || !direction(line, 5, 'E', 'W') ||
            !coordinate(gga.latitude, 90, &fix.latitude) || !coordinate(gga.longitude, 180, &fix.longitude) ||
            gga.altitude.scale <= 0 || gga.altitude_units != 'M') {
            invalidate(p); return 0;
        }
        fix.altitude = (double)gga.altitude.value / gga.altitude.scale;
        if (!useful_fix(&fix)) { invalidate(p); return 0; }
        p->gga = fix;
        p->gga_second_of_day = second_of_day(&gga.time);
        p->gga_microseconds = gga.time.microseconds;
        p->gga_received = now;
        p->gga_ready = true;
    } else return 0;

    if (!p->rmc_ready || !p->gga_ready || p->rmc_second_of_day != p->gga_second_of_day ||
        p->rmc_microseconds != p->gga_microseconds) return 0;
    if (fabs(p->rmc_latitude - p->gga.latitude) > 0.0001 ||
        fabs(p->rmc_longitude - p->gga.longitude) > 0.0001) {
        invalidate(p); return 0;
    }
    if (p->emitted && (p->rmc_utc < p->emitted_utc ||
        (p->rmc_utc == p->emitted_utc && p->rmc_microseconds <= p->emitted_microseconds))) return 0;
    *out = p->gga;
    out->utc = p->rmc_utc;
    p->has_fix = true;
    p->last_valid_monotonic = now;
    p->emitted = true;
    p->emitted_utc = out->utc;
    p->emitted_microseconds = p->rmc_microseconds;
    return 1;
}

char *gps_fix_json(const gps_fix_t *fix) {
    if (!useful_fix(fix)) return NULL;
    struct tm utc;
    char date[32];
    if (!gmtime_r(&fix->utc, &utc) || !strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%SZ", &utc)) return NULL;
    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;
    const bool ok = cJSON_AddNumberToObject(root, "latitude", fix->latitude) &&
        cJSON_AddNumberToObject(root, "longitude", fix->longitude) &&
        cJSON_AddNumberToObject(root, "altitude", fix->altitude) &&
        cJSON_AddNumberToObject(root, "satellites", fix->satellites) &&
        cJSON_AddNumberToObject(root, "fix_quality", fix->fix_quality) &&
        cJSON_AddStringToObject(root, "date", date);
    char *result = ok ? cJSON_PrintUnformatted(root) : NULL;
    cJSON_Delete(root);
    return result;
}
