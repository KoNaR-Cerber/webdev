#include "gps_parser.h"
#include <cJSON.h>
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks;
#define CHECK(condition) do { ++checks; if (!(condition)) { \
    fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); exit(1); } } while (0)

static void sentence(char *out, size_t size, const char *body) {
    unsigned checksum = 0;
    for (const unsigned char *c = (const unsigned char *)body; *c; ++c) checksum ^= *c;
    const int n = snprintf(out, size, "$%s*%02X\r\n", body, checksum);
    CHECK(n > 0 && (size_t)n < size);
}

static int feed(gps_parser_t *p, const char *body, double now, gps_fix_t *out) {
    char line[300];
    sentence(line, sizeof(line), body);
    return gps_parser_feed(p, line, now, out);
}

static int rmc(gps_parser_t *p, const char *clock, const char *date, double now, gps_fix_t *out) {
    char body[220];
    snprintf(body, sizeof(body), "GPRMC,%s,A,5106.0000,N,01700.0000,E,0.0,0.0,%s,,,A", clock, date);
    return feed(p, body, now, out);
}

static int gga(gps_parser_t *p, const char *clock, double now, gps_fix_t *out) {
    char body[220];
    snprintf(body, sizeof(body), "GNGGA,%s,5106.0000,N,01700.0000,E,1,09,0.9,118.4,M,46.9,M,,", clock);
    return feed(p, body, now, out);
}

static void utc_equal(time_t value, const char *expected) {
    struct tm tm;
    char text[40];
    CHECK(gmtime_r(&value, &tm) != NULL);
    CHECK(strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &tm) > 0);
    CHECK(strcmp(text, expected) == 0);
}

static void basic_and_json(void) {
    gps_parser_t p;
    gps_fix_t fix;
    gps_parser_init(&p);
    CHECK(!p.has_fix && p.nmea_count == 0);
    CHECK(rmc(&p, "120000.00", "031126", 10.0, &fix) == 0);
    CHECK(gga(&p, "120000.00", 10.1, &fix) == 1);
    CHECK(p.has_fix && p.nmea_count == 2 && p.satellites == 9);
    CHECK(fabs(fix.latitude - 51.1) < 1e-8 && fabs(fix.longitude - 17.0) < 1e-8);
    CHECK(fabs(fix.altitude - 118.4) < 1e-8 && fix.satellites == 9 && fix.fix_quality == 1);
    utc_equal(fix.utc, "2026-11-03T12:00:00Z");
    char *json = gps_fix_json(&fix);
    CHECK(json != NULL);
    cJSON *root = cJSON_Parse(json);
    CHECK(root != NULL && cJSON_GetArraySize(root) == 6);
    CHECK(cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(root, "latitude")));
    CHECK(fabs(cJSON_GetObjectItemCaseSensitive(root, "latitude")->valuedouble - 51.1) < 1e-8);
    CHECK(strcmp(cJSON_GetObjectItemCaseSensitive(root, "date")->valuestring, "2026-11-03T12:00:00Z") == 0);
    CHECK(cJSON_GetObjectItemCaseSensitive(root, "lat") == NULL);
    CHECK(cJSON_GetObjectItemCaseSensitive(root, "time") == NULL);
    free(json);
    cJSON_Delete(root);
    CHECK(gga(&p, "120000.00", 10.2, &fix) == 0);
    CHECK(rmc(&p, "120000.00", "031126", 10.3, &fix) == 0);
    CHECK(rmc(&p, "115959.00", "031126", 10.4, &fix) == 0);
    CHECK(gga(&p, "115959.00", 10.5, &fix) == 0);
    CHECK(rmc(&p, "120001.00", "031126", 11.0, &fix) == 0);
    CHECK(gga(&p, "120001.00", 11.1, &fix) == 1);
    fix.latitude = NAN;
    CHECK(gps_fix_json(&fix) == NULL);
    fix.latitude = 51.1; fix.altitude = INFINITY;
    CHECK(gps_fix_json(&fix) == NULL);
    fix.altitude = 118.4; fix.fix_quality = 0;
    CHECK(gps_fix_json(&fix) == NULL);
}

static void invalid_fix_clears_both(void) {
    gps_parser_t p;
    gps_fix_t fix;
    gps_parser_init(&p);
    CHECK(rmc(&p, "120000", "031126", 0, &fix) == 0);
    CHECK(gga(&p, "120000", .1, &fix) == 1);
    CHECK(feed(&p, "GPRMC,120001,V,,,,,,,031126,,,N", 1, &fix) == 0);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
    CHECK(gga(&p, "120001", 1.1, &fix) == 0);
    CHECK(rmc(&p, "120001", "031126", 1.2, &fix) == 1);
    CHECK(feed(&p, "GPGGA,120002,,,,,0,00,99.99,,,,,,", 2, &fix) == 0);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready && p.satellites == 0);
    CHECK(rmc(&p, "120002", "031126", 2.1, &fix) == 0);
    CHECK(gga(&p, "120002", 2.2, &fix) == 1);
    char broken[240];
    sentence(broken, sizeof(broken), "GPRMC,120003,A,5106.0000,N,01700.0000,E,0,0,031126,,,A");
    broken[10] ^= 1;
    CHECK(gps_parser_feed(&p, broken, 3, &fix) == 0);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
    CHECK(gps_parser_feed(&p, "$GPRMC,120000,A", 3.1, &fix) == 0);
    CHECK(gps_parser_feed(&p, "garbage", 3.2, &fix) == 0);
}

static void freshness_and_mismatches(void) {
    gps_parser_t p;
    gps_fix_t fix;
    gps_parser_init(&p);
    CHECK(rmc(&p, "120000", "031126", 0, &fix) == 0);
    CHECK(gga(&p, "120000", 2.01, &fix) == 0);
    CHECK(rmc(&p, "120000", "031126", 2.1, &fix) == 1);
    gps_parser_expire(&p, 4.11);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
    CHECK(rmc(&p, "120001", "031126", 5, &fix) == 0);
    CHECK(gga(&p, "120002", 5.1, &fix) == 0);
    CHECK(rmc(&p, "120002", "031126", 5.2, &fix) == 1);
    CHECK(rmc(&p, "120003.00", "031126", 6, &fix) == 0);
    CHECK(gga(&p, "120003.50", 6.1, &fix) == 0);
    CHECK(rmc(&p, "120003.50", "031126", 6.2, &fix) == 1);
    gps_parser_expire(&p, 1);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
    CHECK(rmc(&p, "120004", "031126", 7, &fix) == 0);
    CHECK(feed(&p, "GNGGA,120004,5206.0000,N,01700.0000,E,1,09,0.9,118.4,M,46.9,M,,", 7.1, &fix) == 0);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
}

static void midnight_and_dates(void) {
    gps_parser_t p;
    gps_fix_t fix;
    gps_parser_init(&p);
    CHECK(rmc(&p, "235959", "311226", 0, &fix) == 0);
    CHECK(gga(&p, "235959", .1, &fix) == 1);
    const time_t before = fix.utc;
    utc_equal(before, "2026-12-31T23:59:59Z");
    CHECK(gga(&p, "000000", 1, &fix) == 0);
    CHECK(rmc(&p, "000000", "010127", 1.1, &fix) == 1);
    CHECK(fix.utc == before + 1);
    utc_equal(fix.utc, "2027-01-01T00:00:00Z");
    CHECK(rmc(&p, "000001", "010127", 2, &fix) == 0);
    CHECK(gga(&p, "000001", 2.1, &fix) == 1);
    gps_parser_init(&p);
    CHECK(gga(&p, "120000", 0, &fix) == 0);
    CHECK(rmc(&p, "120000", "290226", .1, &fix) == 0);
    CHECK(!p.rmc_ready && !p.gga_ready);
    CHECK(rmc(&p, "120000", "290224", .2, &fix) == 0);
    CHECK(gga(&p, "120000", .3, &fix) == 1);
    utc_equal(fix.utc, "2024-02-29T12:00:00Z");
    CHECK(rmc(&p, "250000", "031126", .4, &fix) == 0);
    CHECK(!p.has_fix);
}

static void no_missing_or_impossible_coordinates(void) {
    gps_parser_t p;
    gps_fix_t fix;
    gps_parser_init(&p);
    CHECK(feed(&p, "GPRMC,120000,A,0000.0000,N,00000.0000,E,0,0,031126,,,A", 0, &fix) == 0);
    CHECK(feed(&p, "GNGGA,120000,0000.0000,N,00000.0000,E,1,09,0.9,0.0,M,0.0,M,,", .1, &fix) == 1);
    CHECK(fix.latitude == 0 && fix.longitude == 0 && fix.altitude == 0);
    char *json = gps_fix_json(&fix);
    CHECK(json != NULL);
    free(json);
    CHECK(feed(&p, "GPRMC,120001,A,5106.0000,,01700.0000,E,0,0,031126,,,A", 1, &fix) == 0);
    CHECK(!p.has_fix);
    CHECK(feed(&p, "GPRMC,120001,A,5106.0000,E,01700.0000,E,0,0,031126,,,A", 1.1, &fix) == 0);
    CHECK(!p.rmc_ready);
    CHECK(feed(&p, "GPRMC,120001,A,5161.0000,N,01700.0000,E,0,0,031126,,,A", 1.2, &fix) == 0);
    CHECK(feed(&p, "GPRMC,120001,A,9100.0000,N,01700.0000,E,0,0,031126,,,A", 1.3, &fix) == 0);
    CHECK(feed(&p, "GNGGA,120001,5106.0000,N,01700.0000,E,1,09,0.9,,M,46.9,M,,", 1.4, &fix) == 0);
    CHECK(feed(&p, "GNGGA,120001,5106.0000,N,01700.0000,E,6,09,0.9,118.4,M,46.9,M,,", 1.5, &fix) == 0);
    CHECK(feed(&p, "GNGGA,120001,5106.0000,N,01700.0000,E,1,00,0.9,118.4,M,46.9,M,,", 1.6, &fix) == 0);
    CHECK(!p.has_fix && !p.rmc_ready && !p.gga_ready);
}

int main(void) {
    /* A non-UTC process timezone must never leak into GPS dates. */
    setenv("TZ", "JST-9", 1);
    tzset();
    basic_and_json();
    invalid_fix_clears_both();
    freshness_and_mismatches();
    midnight_and_dates();
    no_missing_or_impossible_coordinates();
    printf("gps parser checks: %u passed\n", checks);
    return 0;
}
