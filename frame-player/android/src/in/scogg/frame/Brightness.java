package in.scogg.frame;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import java.io.*;
import java.util.Calendar;
import java.util.TimeZone;

final class Brightness {
  static int target(int minute, int daytime) {
    if (minute < 6 * 60 + 30)
      return 0;
    return minute >= 23 * 60 ? 1 : daytime;
  }
  static int currentTarget(Context c) {
    SharedPreferences prefs = c.getSharedPreferences("player", 0);
    Calendar clock =
        Calendar.getInstance(TimeZone.getTimeZone("America/Chicago"));
    return target(clock.get(Calendar.HOUR_OF_DAY) * 60 +
                      clock.get(Calendar.MINUTE),
                  prefs.getInt("dayBrightness", 5));
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
