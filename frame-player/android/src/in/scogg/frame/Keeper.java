package in.scogg.frame;
import android.app.*;
import android.content.*;
import android.os.*;
import java.io.*;

/** Keeps root SSH available and restarts playback after an activity failure. */
public class Keeper extends Service {
  public static volatile long heartbeat;
  Handler handler = new Handler();
  PowerManager.WakeLock wake;
  volatile boolean stopped;
  public IBinder onBind(Intent i) { return null; }
  public int onStartCommand(Intent i, int f, int id) { return START_STICKY; }
  Runnable monitor = new Runnable() {
    public void run() {
      Brightness.apply(Keeper.this);
      long now = SystemClock.elapsedRealtime();
      if (getSharedPreferences("player", 0).getBoolean("playing", true) &&
          now - heartbeat > 45000) {
        heartbeat = now;
        startActivity(new Intent(Keeper.this, NativeArt.class)
                          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      }
      handler.postDelayed(this, 15000);
    }
  };
  public void onCreate() {
    super.onCreate();
    Brightness.apply(this);
    heartbeat = SystemClock.elapsedRealtime();
    Notification n =
        new Notification.Builder(this)
            .setContentTitle("Frame Art")
            .setContentText("Road player and SSH are running")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(PendingIntent.getActivity(
                this, 0,
                new Intent(this, Home.class).putExtra("maintenance", true), 0))
            .build();
    startForeground(1, n);
    wake = ((PowerManager)getSystemService(POWER_SERVICE))
               .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FrameArt");
    wake.acquire();
    handler.postDelayed(monitor, 15000);
    new Thread(new Runnable() {
      public void run() {
        String previous = "";
        while (!stopped) {
          String result;
          try {
            result =
                "SSH: " +
                RootAdb.run("/system/bin/sh /data/local/frame/start-ssh.sh");
            result += Brightness.applyDisplayTarget(
                Brightness.currentTarget(Keeper.this));
          } catch (Exception e) {
            result = e.toString();
          }
          if (!result.equals(previous)) {
            log(result);
            previous = result;
          }
          try {
            Thread.sleep(15000);
          } catch (InterruptedException e) {
            return;
          }
        }
      }
    }).start();
  }
  synchronized void log(String s) {
    try {
      File file = new File(getFilesDir(), "player.log");
      if (file.length() > 1048576)
        file.delete();
      FileWriter w = new FileWriter(file, true);
      w.write(System.currentTimeMillis() + " " + s + "\n");
      w.close();
    } catch (Exception ignored) {
    }
  }
  public void onDestroy() {
    stopped = true;
    handler.removeCallbacks(monitor);
    if (wake != null)
      wake.release();
    super.onDestroy();
  }
}
