package in.scogg.frame;
import android.content.*;
public class Boot extends BroadcastReceiver {
  public void onReceive(Context c, Intent i) {
    c.startService(new Intent(c, Keeper.class));
    c.startActivity(
        new Intent(c, Home.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }
}
