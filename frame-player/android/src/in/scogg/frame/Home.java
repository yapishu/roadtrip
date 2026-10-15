package in.scogg.frame;
import android.app.*;
import android.content.*;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class Home extends Activity {
  public void onCreate(Bundle b) {
    super.onCreate(b);
    startService(new Intent(this, Keeper.class));
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(1);
    layout.setPadding(60, 40, 60, 20);
    TextView title = new TextView(this);
    title.setText("Frame Art");
    title.setTextSize(24);
    layout.addView(title);
    button(layout, "Open the road", new Runnable() {
      public void run() { art(); }
    });
    button(layout, "Wi-Fi settings", new Runnable() {
      public void run() {
        startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
      }
    });
    button(layout, "Android settings", new Runnable() {
      public void run() { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    });
    TextView label = new TextView(this);
    label.setText("Morning brightness · Austin sunrise/sunset\n"
                  + "Full at 9 AM · double at noon · half after sunset\n"
                  + "Brightness 1 at 11 PM · off midnight–6:30 AM Central");
    layout.addView(label);
    SeekBar brightness = new SeekBar(this);
    brightness.setMax(254);
    brightness.setProgress(
        getSharedPreferences("player", 0)
            .getInt("dayBrightness", Brightness.DEFAULT_DAYTIME) -
        1);
    brightness.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {}
          public void onStopTrackingTouch(SeekBar s) {}
          public void onProgressChanged(SeekBar s, int p, boolean user) {
            if (user) {
              getSharedPreferences("player", 0)
                  .edit()
                  .putInt("dayBrightness", p + 1)
                  .apply();
              Brightness.apply(Home.this);
            }
          }
        });
    layout.addView(brightness);
    TextView credits = new TextView(this);
    credits.setText("Map © OpenStreetMap contributors · Terrain & imagery: "
                    + "USGS, Mapzen/AWS · Borders: US Census · Reference "
                    + "façades: Google Street View · Regional materials: SDXL");
    credits.setTextSize(10);
    layout.addView(credits);
    setContentView(layout);
  }
  void button(LinearLayout parent, String text, final Runnable action) {
    Button b = new Button(this);
    b.setText(text);
    b.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) { action.run(); }
    });
    parent.addView(b);
  }
  void art() { startActivity(new Intent(this, NativeArt.class)); }
  public void onResume() {
    super.onResume();
    getSharedPreferences("player", 0)
        .edit()
        .putBoolean("playing", false)
        .apply();
  }
}
