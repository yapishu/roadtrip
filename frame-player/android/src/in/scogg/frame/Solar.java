package in.scogg.frame;

import java.util.Calendar;
import java.util.TimeZone;

/** Austin sunrise and sunset, in Central wall-clock minutes. */
final class Solar {
  static final TimeZone ZONE = TimeZone.getTimeZone("America/Chicago");

  static int[] times(Calendar date) {
    Calendar noon = Calendar.getInstance(ZONE);
    noon.setTimeInMillis(date.getTimeInMillis());
    noon.set(Calendar.HOUR_OF_DAY, 12);
    noon.set(Calendar.MINUTE, 0);
    // NOAA fractional-year equations, evaluated at local noon:
    // https://gml.noaa.gov/grad/solcalc/solareqns.PDF
    double year = 2 * Math.PI * (noon.get(Calendar.DAY_OF_YEAR) - 1) /
                  noon.getActualMaximum(Calendar.DAY_OF_YEAR);
    double equation =
        229.18 *
        (0.000075 + 0.001868 * Math.cos(year) - 0.032077 * Math.sin(year) -
         0.014615 * Math.cos(2 * year) - 0.040849 * Math.sin(2 * year));
    double declination =
        0.006918 - 0.399912 * Math.cos(year) + 0.070257 * Math.sin(year) -
        0.006758 * Math.cos(2 * year) + 0.000907 * Math.sin(2 * year) -
        0.002697 * Math.cos(3 * year) + 0.00148 * Math.sin(3 * year);
    double latitude = Math.toRadians(30.2672);
    double angle = Math.toDegrees(
        Math.acos(Math.cos(Math.toRadians(90.833)) /
                      (Math.cos(latitude) * Math.cos(declination)) -
                  Math.tan(latitude) * Math.tan(declination)));
    double midday = 720 - 4 * -97.7431 - equation +
                    ZONE.getOffset(noon.getTimeInMillis()) / 60000.0;
    return new int[] {(int)Math.round(midday - 4 * angle),
                      (int)Math.round(midday + 4 * angle)};
  }
}
