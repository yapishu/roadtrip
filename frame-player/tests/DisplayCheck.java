package in.scogg.frame;
public final class DisplayCheck {
  public static void main(String[] args) throws Exception {
    int restore = Integer.parseInt(args[0]);
    try {
      System.out.println(Brightness.applyDisplayTarget(0));
      Thread.sleep(2000);
      System.out.println(Brightness.read("/sys/class/disp/disp/attr/lcd"));
    } finally {
      System.out.println(Brightness.applyDisplayTarget(restore));
    }
  }
}
