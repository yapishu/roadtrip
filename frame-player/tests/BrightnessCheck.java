package in.scogg.frame;

import java.util.Calendar;
import java.util.TimeZone;

public class BrightnessCheck {
  static Calendar day(int year, int month, int date) {
    Calendar c = Calendar.getInstance(Solar.ZONE);
    c.clear();
    c.set(year, month - 1, date, 12, 0);
    return c;
  }
  static void equal(int actual, int expected, String label) {
    if (actual != expected)
      throw new AssertionError(label + ": " + actual + " != " + expected);
  }
  public static void main(String[] args) {
    // US Naval Observatory one-day data for Austin; allow four minutes for
    // NOAA's fractional-year approximation, which is adequate for dimming.
    // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-14&coords=30.2672,-97.7431&tz=-5
    for (int[] row : new int[][] {{10, 14, 453, 1141},
                                  {6, 21, 390, 1236},
                                  {12, 21, 443, 1055},
                                  {3, 8, 469, 1175},
                                  {11, 1, 405, 1063}}) {
      int[] sun = Solar.times(day(2026, row[0], row[1]));
      for (int i = 0; i < 2; i++)
        if (Math.abs(sun[i] - row[i + 2]) > 4)
          throw new AssertionError("Solar time " + row[0] + "/" + row[1] +
                                   ": " + sun[i]);
      System.out.println(row[0] + "/" + row[1] + " sunrise=" + sun[0] +
                         " sunset=" + sun[1]);
    }
    for (int[] pair : new int[][] {{0, 0},
                                   {389, 0},
                                   {390, 5},
                                   {450, 5},
                                   {495, 8},
                                   {539, 10},
                                   {540, 10},
                                   {719, 10},
                                   {720, 20},
                                   {1080, 20},
                                   {1110, 13},
                                   {1140, 5},
                                   {1379, 5},
                                   {1380, 1},
                                   {1439, 1}})
      equal(Brightness.target(pair[0], 10, 450, 1140), pair[1],
            "minute " + pair[0]);

    // Every date, including the leap day and both DST transitions, preserves
    // wake, peak, sunset and off levels; Android's own timezone cannot alter
    // it.
    TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"));
    Calendar c = day(2026, 1, 1);
    for (int n = 0; n < 365 + 365 + 366; n++, c.add(Calendar.DATE, 1)) {
      int[] sun = Solar.times(c);
      if (sun[0] <= 380 || sun[0] >= 540 || sun[1] <= 1020 || sun[1] >= 1260)
        throw new AssertionError("Austin solar range");
      for (int peak : new int[] {1, 10, 255}) {
        equal(Brightness.target(540, peak, sun[0], sun[1]), peak, "9 AM peak");
        equal(Brightness.target(719, peak, sun[0], sun[1]), peak,
              "before noon");
        equal(Brightness.target(720, peak, sun[0], sun[1]),
              Math.min(255, peak * 2), "noon peak");
        equal(Brightness.target(sun[1], peak, sun[0], sun[1]),
              Math.max(1, peak / 2), "sunset");
        equal(Brightness.target(389, peak, sun[0], sun[1]), 0, "asleep");
        equal(Brightness.target(1380, peak, sun[0], sun[1]), 1, "11 PM");
      }
      for (int[] pair : new int[][] {{0, 0},
                                     {389, 0},
                                     {390, 5},
                                     {540, 10},
                                     {719, 10},
                                     {720, 20},
                                     {1380, 1}}) {
        c.set(Calendar.HOUR_OF_DAY, pair[0] / 60);
        c.set(Calendar.MINUTE, pair[0] % 60);
        equal(Brightness.targetAt(c.getTimeInMillis(), 10), pair[1],
              "Central clock");
      }
      c.set(Calendar.HOUR_OF_DAY, 12);
      c.set(Calendar.MINUTE, 0);
    }
    System.out.println(
        "Solar references, ramps, overnight boundaries and Central DST passed");
  }
}
