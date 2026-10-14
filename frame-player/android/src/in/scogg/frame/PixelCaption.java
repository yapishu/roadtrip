package in.scogg.frame;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import java.io.*;
import java.util.*;
import org.json.*;

final class PixelCaption extends View {
  JSONObject font;
  String text = "";
  final Paint paint = new Paint();
  PixelCaption(Context c) {
    super(c);
    try {
      InputStream in = c.getAssets().open("caption-font.json");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      try {
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) != -1)
          out.write(b, 0, n);
      } finally {
        in.close();
      }
      font = new JSONObject(out.toString("UTF-8"));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
  void setText(String value) {
    String next =
        java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
            .replaceAll("[\\p{M}]", "")
            .toUpperCase(Locale.US)
            .replace('→', '>')
            .replace('·', '-');
    if (next.equals(text))
      return;
    text = next;
    setContentDescription(value);
    invalidate();
  }
  int width(String value) {
    int n = -1;
    for (char ch : value.toCharArray()) {
      JSONArray glyph = font.optJSONArray(String.valueOf(ch));
      n += (glyph == null ? 3 : glyph.optString(0).length()) + 1;
    }
    return n;
  }
  void write(Canvas c, String value, int x, int y, int scale, int color) {
    paint.setColor(color);
    for (char ch : value.toCharArray()) {
      JSONArray glyph = font.optJSONArray(String.valueOf(ch));
      if (glyph == null)
        glyph = font.optJSONArray(" ");
      for (int row = 0; row < glyph.length(); row++) {
        String line = glyph.optString(row);
        for (int col = 0; col < line.length(); col++)
          if (line.charAt(col) == '#')
            c.drawRect(x + col * scale, y + row * scale, x + (col + 1) * scale,
                       y + (row + 1) * scale, paint);
      }
      x += (glyph.optString(0).length() + 1) * scale;
    }
  }
  protected void onDraw(Canvas c) {
    int scale = getWidth() >= 700 ? 3 : 2;
    ArrayList<String> lines = new ArrayList<String>();
    String line = "";
    for (String word : text.split(" ")) {
      String trial = line.isEmpty() ? word : line + " " + word;
      if (width(trial) * scale > getWidth() - 16 && !line.isEmpty()) {
        lines.add(line);
        line = word;
      } else
        line = trial;
    }
    if (!line.isEmpty())
      lines.add(line);
    for (int i = 0; i < lines.size(); i++) {
      String value = lines.get(i);
      int x = (getWidth() - width(value) * scale) / 2,
          y = getHeight() - (lines.size() - i) * 9 * scale;
      write(c, value, x + scale, y + scale, scale, 0xff211c27);
      write(c, value, x, y, scale, 0xfffff2d9);
    }
  }
}
