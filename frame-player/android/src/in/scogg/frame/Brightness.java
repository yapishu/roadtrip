package in.scogg.frame;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import java.io.*;
import java.util.Calendar;

final class Brightness {
  static final int DEFAULT_DAYTIME = 10;
  static int target(int minute, int daytime, int sunrise, int sunset) {
    if (minute < 6 * 60 + 30)
      return 0;
    if (minute >= 23 * 60)
      return 1;
    daytime = Math.max(1, Math.min(255, daytime));
    int dim = Math.max(1, daytime / 2);
    int peak = minute >= 12 * 60 ? Math.min(255, daytime * 2) : daytime;
    double morning = (minute - sunrise) / (double)(9 * 60 - sunrise);
    double evening = (sunset - minute) / 60.0;
    double daylight = Math.max(0, Math.min(1, Math.min(morning, evening)));
    return dim + (int)Math.round((peak - dim) * daylight);
  }
  static int targetAt(long time, int daytime) {
    Calendar clock = Calendar.getInstance(Solar.ZONE);
    clock.setTimeInMillis(time);
    int[] sun = Solar.times(clock);
    return target(clock.get(Calendar.HOUR_OF_DAY) * 60 +
                      clock.get(Calendar.MINUTE),
                  daytime, sun[0], sun[1]);
  }
  static int currentTarget(Context c) {
    SharedPreferences prefs = c.getSharedPreferences("player", 0);
    return targetAt(System.currentTimeMillis(),
                    prefs.getInt("dayBrightness", DEFAULT_DAYTIME));
  }
  static String read(String path) throws IOException {
    BufferedReader reader = new BufferedReader(new FileReader(path));
    try {
      return reader.readLine();
    } finally {
      reader.close();
    }
  }
  static String applyDisplayTarget(int value) throws IOException {
    String path = "/sys/class/disp/disp/attr/";
    String power = read(path + "lcd");
    boolean on = "screen0 lcd on!".equals(power);
    if (!on && !"screen0 lcd off!".equals(power))
      throw new IOException("Unknown display power state: " + power);
    if (value == 0) {
      if (on) {
        String result =
            RootAdb.run("echo 0 > " + path + "lcd; cat " + path + "lcd").trim();
        if (!"screen0 lcd off!".equals(result))
          throw new IOException("Display shutoff failed: " + result);
      }
      return "Display off";
    }
    if (!on || !String.valueOf(value).equals(read(path + "lcdbl"))) {
      String command = on ? "" : "echo 1 > " + path + "lcd; ";
      RootAdb.run(command + "echo " + value + " > " + path + "lcdbl");
      if (!"screen0 lcd on!".equals(read(path + "lcd")) ||
          !String.valueOf(value).equals(read(path + "lcdbl")))
        throw new IOException("Display wake/brightness update failed");
    }
    return "Display on, brightness " + value;
  }
  static void apply(Context c) {
    // Keep playback awake; the display driver powers the LCD off overnight.
    int value = Math.max(1, currentTarget(c));
    if (Settings.System.getInt(c.getContentResolver(),
                               Settings.System.SCREEN_BRIGHTNESS_MODE, 0) != 0)
      Settings.System.putInt(c.getContentResolver(),
                             Settings.System.SCREEN_BRIGHTNESS_MODE, 0);
    if (Settings.System.getInt(c.getContentResolver(),
                               Settings.System.SCREEN_BRIGHTNESS, -1) != value)
      Settings.System.putInt(c.getContentResolver(),
                             Settings.System.SCREEN_BRIGHTNESS, value);
  }
}
