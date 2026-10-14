package in.scogg.frame;
public class BrightnessCheck {
  public static void main(String[] args) {
    for (int[] pair : new int[][]{{0,0},{389,0},{390,5},{1079,5},{1080,5},{1379,5},{1380,1},{1409,1},{1410,1},{1439,1}})
      if (Brightness.target(pair[0],5) != pair[1]) throw new AssertionError(pair[0]);
    System.out.println("Brightness boundaries passed: 6:30 AM 5 / 11 PM 1 / midnight display off");
  }
}
