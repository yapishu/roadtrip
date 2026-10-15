package in.scogg.frame;
import android.app.*;
import android.content.*;
import android.opengl.GLSurfaceView;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;
import org.json.*;

public class NativeArt extends Activity implements GLSurfaceView.Renderer {
  static { System.loadLibrary("frame"); }
  public static native void init(String path, double position);
  public static native void resize(int width, int height);
  public static native void frame();
  public static native double position();
  public static native String status();
  public static native void pause();
  public static native void seek(double distance);
  public static native String caption();
  GLSurfaceView view;
  TextView label;
  PixelCaption captionView;
  LinearLayout controls, timeline;
  FrameLayout mapPanel;
  LocalMap map;
  Button mapButton;
  SeekBar seekbar;
  TextView distanceLabel;
  JSONArray stops = new JSONArray();
  double total = 1;
  float currentPosition;
  boolean dragging, expanded, choosing;
  Runnable collapse = new Runnable() {
    public void run() {
      expandMap(false);
      hide.run();
    }
  };
  Handler handler = new Handler();
  long lastSave, nextFrame;
  boolean created = false;
  Runnable hide = new Runnable() {
    public void run() {
      if (dragging || choosing)
        return;
      controls.setVisibility(View.GONE);
      timeline.setVisibility(View.GONE);
    }
  };
  public void onCreate(Bundle b) {
    super.onCreate(b);
    startService(new Intent(this, Keeper.class));
    getWindow().addFlags(128 | 1024);
    getWindow().getDecorView().setSystemUiVisibility(5894);
    FrameLayout layout = new FrameLayout(this);
    view = new GLSurfaceView(this);
    view.setEGLContextClientVersion(2);
    view.setEGLConfigChooser(8, 8, 8, 8, 16, 0);
    view.setPreserveEGLContextOnPause(true);
    view.setRenderer(this);
    layout.addView(view);
    controls = new LinearLayout(this);
    controls.setOrientation(1);
    controls.setPadding(dp(12), dp(8), dp(12), dp(8));
    controls.setBackgroundColor(0x99000000);
    label = new TextView(this);
    label.setTextColor(-1);
    label.setTextSize(13);
    label.setText("Loading the local scene…");
    controls.addView(label);
    Button p = new Button(this);
    p.setText("Pause / play");
    p.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) {
        view.queueEvent(new Runnable() {
          public void run() { pause(); }
        });
      }
    });
    controls.addView(p);
    Button locations = new Button(this);
    locations.setText("Visit a stop…");
    locations.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) { chooseLocation(); }
    });
    controls.addView(locations);
    Button settings = new Button(this);
    settings.setText("Settings");
    settings.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) {
        startActivity(new Intent(NativeArt.this, Home.class));
      }
    });
    controls.addView(settings);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(340), -2);
    lp.gravity = Gravity.TOP | Gravity.RIGHT;
    lp.rightMargin = dp(246);
    lp.topMargin = dp(18);
    layout.addView(controls, lp);
    mapPanel = new FrameLayout(this);
    map = new LocalMap(this);
    mapPanel.addView(map, new FrameLayout.LayoutParams(-1, -1));
    map.expand = new Runnable() {
      public void run() { expandMap(true); }
    };
    mapButton = new Button(this);
    mapButton.setText("+");
    mapButton.setTextSize(16);
    mapButton.setTextColor(0xff3c4138);
    mapButton.setBackgroundColor(0xffece3c9);
    mapButton.setPadding(0, 0, 0, 0);
    mapButton.setContentDescription("Expand terrain map");
    mapButton.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) { expandMap(!expanded); }
    });
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(dp(28), dp(28));
    bp.gravity = Gravity.TOP | Gravity.RIGHT;
    bp.topMargin = dp(6);
    bp.rightMargin = dp(6);
    mapPanel.addView(mapButton, bp);
    FrameLayout.LayoutParams mp =
        new FrameLayout.LayoutParams(dp(208), dp(144));
    mp.gravity = Gravity.TOP | Gravity.RIGHT;
    mp.rightMargin = dp(20);
    mp.topMargin = dp(18);
    layout.addView(mapPanel, mp);
    timeline = new LinearLayout(this);
    timeline.setOrientation(1);
    timeline.setPadding(dp(16), dp(4), dp(16), dp(4));
    timeline.setBackgroundColor(0xaa000000);
    distanceLabel = new TextView(this);
    distanceLabel.setTextColor(-1);
    distanceLabel.setGravity(Gravity.CENTER);
    timeline.addView(distanceLabel);
    seekbar = new SeekBar(this);
    seekbar.setMax(100000);
    seekbar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      public void onStartTrackingTouch(SeekBar s) {
        dragging = true;
        handler.removeCallbacks(hide);
      }
      public void onStopTrackingTouch(SeekBar s) {
        seekTo(total * s.getProgress() / s.getMax());
        dragging = false;
        showControls();
      }
      public void onProgressChanged(SeekBar s, int progress, boolean user) {
        if (user)
          showDistance(total * progress / s.getMax());
      }
    });
    timeline.addView(seekbar, new LinearLayout.LayoutParams(-1, dp(48)));
    FrameLayout.LayoutParams tp = new FrameLayout.LayoutParams(-1, -2);
    tp.gravity = Gravity.BOTTOM;
    tp.bottomMargin = dp(100);
    tp.leftMargin = dp(12);
    tp.rightMargin = dp(12);
    layout.addView(timeline, tp);
    readJourney();
    captionView = new PixelCaption(this);
    FrameLayout.LayoutParams cp = new FrameLayout.LayoutParams(-1, dp(63));
    cp.gravity = Gravity.BOTTOM;
    cp.bottomMargin = 24;
    layout.addView(captionView, cp);
    setContentView(layout);
    view.setOnTouchListener(new View.OnTouchListener() {
      public boolean onTouch(View v, android.view.MotionEvent e) {
        if (e.getAction() == 1) {
          showControls();
        }
        return true;
      }
    });
    hide.run();
  }
  int dp(float value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
  void showControls() {
    controls.setVisibility(View.VISIBLE);
    timeline.setVisibility(View.VISIBLE);
    handler.removeCallbacks(hide);
    handler.postDelayed(hide, 6000);
  }
  void expandMap(boolean large) {
    expanded = large;
    handler.removeCallbacks(collapse);
    FrameLayout.LayoutParams params =
        (FrameLayout.LayoutParams)mapPanel.getLayoutParams();
    params.width =
        large
            ? Math.min(dp(660),
                       getResources().getDisplayMetrics().widthPixels - dp(44))
            : dp(208);
    params.height =
        large ? Math.min((int)(params.width / 1.65),
                         getResources().getDisplayMetrics().heightPixels -
                             dp(154))
              : dp(144);
    mapPanel.setLayoutParams(params);
    mapButton.setText(large ? "−" : "+");
    mapButton.setContentDescription(large ? "Collapse terrain map"
                                          : "Expand terrain map");
    map.setExpanded(large);
    FrameLayout.LayoutParams cp =
        (FrameLayout.LayoutParams)controls.getLayoutParams();
    cp.rightMargin = params.width + dp(38);
    controls.setLayoutParams(cp);
    if (large)
      handler.postDelayed(collapse, 30000);
  }
  void showDistance(double at) {
    String name = "";
    double nearest = Double.MAX_VALUE;
    for (int i = 0; i < stops.length(); i++) {
      JSONObject stop = stops.optJSONObject(i);
      double delta = Math.abs(stop.optDouble("at") - at);
      if (delta < nearest) {
        nearest = delta;
        name = stop.optString("name");
      }
    }
    distanceLabel.setText(String.format(java.util.Locale.US,
                                        "%s · %.1f / %.0f km", name, at / 1000,
                                        total / 1000));
  }
  void seekTo(final double at) {
    view.queueEvent(new Runnable() {
      public void run() { seek(Math.min(at, total - .01)); }
    });
  }
  void readJourney() {
    try {
      InputStream in = new FileInputStream(
          new File(getExternalFilesDir(null), "native/journey.json"));
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try {
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) != -1)
          bytes.write(buffer, 0, n);
      } finally {
        in.close();
      }
      JSONObject data = new JSONObject(bytes.toString("UTF-8"));
      total = data.getDouble("total");
      stops = data.getJSONArray("stops");
    } catch (Exception e) {
      android.util.Log.e("Frame", "Cannot read itinerary", e);
    }
  }
  void chooseLocation() {
    String[] names = new String[stops.length()];
    int selected = 0;
    for (int i = 0; i < stops.length(); i++) {
      JSONObject stop = stops.optJSONObject(i);
      names[i] = stop.optString("name");
      if (stop.optDouble("at") <= currentPosition)
        selected = i;
    }
    choosing = true;
    handler.removeCallbacks(hide);
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle("Visit a stop")
            .setSingleChoiceItems(
                names, selected,
                new DialogInterface.OnClickListener() {
                  public void onClick(DialogInterface dialog, int which) {
                    seekTo(stops.optJSONObject(which).optDouble("at"));
                    dialog.dismiss();
                  }
                })
            .setNegativeButton("Cancel", null)
            .create();
    dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
      public void onDismiss(DialogInterface dialog) {
        choosing = false;
        showControls();
      }
    });
    dialog.show();
    dialog.getWindow().setLayout(
        Math.min(dp(440),
                 getResources().getDisplayMetrics().widthPixels - dp(40)),
        Math.min(dp(560),
                 getResources().getDisplayMetrics().heightPixels - dp(60)));
  }
  public boolean dispatchTouchEvent(MotionEvent event) {
    if (event.getAction() == MotionEvent.ACTION_DOWN)
      handler.removeCallbacks(hide);
    if (event.getAction() == MotionEvent.ACTION_UP ||
        event.getAction() == MotionEvent.ACTION_CANCEL)
      handler.postDelayed(hide, 6000);
    return super.dispatchTouchEvent(event);
  }
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    map.loader.shutdownNow();
    super.onDestroy();
  }
  public void onSurfaceCreated(GL10 gl, EGLConfig config) {
    init(
        new java.io.File(getExternalFilesDir(null), "native").getAbsolutePath(),
        getIntent().hasExtra("km") ? getIntent().getFloatExtra("km", 0) * 1000.0
                                   : getPreferences(0).getFloat("position", 0));
    if (getIntent().getBooleanExtra("paused", false))
      pause();
    created = true;
  }
  public void onSurfaceChanged(GL10 gl, int w, int h) { resize(w, h); }
  public void onDrawFrame(GL10 gl) {
    long start = System.nanoTime(), wait = nextFrame - start;
    if (wait > 1000000)
      try {
        Thread.sleep(wait / 1000000);
      } catch (InterruptedException ignored) {
      }
    nextFrame = System.nanoTime() + 16666667;
    frame();
    long now = SystemClock.elapsedRealtime();
    if (now - lastSave > 1000) {
      lastSave = now;
      Keeper.heartbeat = now;
      final String text = status(), place = caption();
      final float at = (float)position();
      handler.post(new Runnable() {
        public void run() {
          label.setText(text);
          currentPosition = at;
          if (!dragging) {
            seekbar.setProgress((int)(at / total * seekbar.getMax()));
            showDistance(at);
          }
          map.update(at);
          captionView.setText(place.toUpperCase(java.util.Locale.US));
          getPreferences(0).edit().putFloat("position", at).apply();
        }
      });
    }
  }

  protected void onNewIntent(final Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent.hasExtra("km"))
      view.queueEvent(new Runnable() {
        public void run() { seek(intent.getFloatExtra("km", 0) * 1000.0); }
      });
  }
  public void onResume() {
    super.onResume();
    getSharedPreferences("player", 0)
        .edit()
        .putBoolean("playing", true)
        .apply();
    if (view != null)
      view.onResume();
  }
  public void onPause() {
    super.onPause();
    if (view != null)
      view.onPause();
  }
  public void onBackPressed() { startActivity(new Intent(this, Home.class)); }
  public void onWindowFocusChanged(boolean focus) {
    super.onWindowFocusChanged(focus);
    if (focus)
      getWindow().getDecorView().setSystemUiVisibility(5894);
  }
}
