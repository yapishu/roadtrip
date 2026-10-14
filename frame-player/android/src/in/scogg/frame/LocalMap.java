package in.scogg.frame;
import android.content.Context;
import android.graphics.*;
import android.view.*;
import java.io.*;
import java.nio.*;
import java.util.concurrent.*;
import org.json.*;

final class LocalMap extends View {
  final ExecutorService loader = Executors.newSingleThreadExecutor();
  final Paint paint = new Paint();
  JSONObject atlas;
  JSONArray states, stops;
  double[][] route;
  short[] heights;
  double x0, y0, cell, x, y, dx, dy, centerX, centerY, span = 450000;
  int gridW, gridH;
  boolean expanded, follow = true;
  Bitmap backdrop;
  String drawn = "";
  double position;
  float touchX, touchY;
  double startX, startY;
  boolean moved;
  Runnable expand;
  LocalMap(Context c) {
    super(c);
    loader.execute(new Runnable() {
      public void run() {
        try {
          final JSONObject data =
              new JSONObject(new String(read("atlas.json"), "UTF-8"));
          byte[] elevations = read("terrain.bin");
          final short[] terrain = new short[elevations.length / 2];
          ByteBuffer.wrap(elevations)
              .order(ByteOrder.LITTLE_ENDIAN)
              .asShortBuffer()
              .get(terrain);
          byte[] points = read("map-route.bin");
          DoubleBuffer values = ByteBuffer.wrap(points)
                                    .order(ByteOrder.LITTLE_ENDIAN)
                                    .asDoubleBuffer();
          final double[][] path = new double[points.length / 24][3];
          for (int i = 0; i < path.length; i++)
            values.get(path[i]);
          new android.os.Handler(android.os.Looper.getMainLooper())
              .post(new Runnable() {
                public void run() {
                  atlas = data;
                  heights = terrain;
                  route = path;
                  JSONObject grid = data.optJSONObject("terrain");
                  x0 = grid.optDouble("x0");
                  y0 = grid.optDouble("y0");
                  cell = grid.optDouble("cell");
                  gridW = grid.optInt("w");
                  gridH = grid.optInt("h");
                  states = data.optJSONArray("states");
                  stops = data.optJSONArray("stops");
                  update(position);
                }
              });
        } catch (Exception e) {
          android.util.Log.e("FrameMap", "Cannot load atlas", e);
        }
      }
    });
  }
  byte[] read(String name) throws IOException {
    InputStream in = getContext().getAssets().open(name);
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int n;
      while ((n = in.read(buffer)) != -1)
        out.write(buffer, 0, n);
      return out.toByteArray();
    } finally {
      in.close();
    }
  }
  void update(double at) {
    position = at;
    if (route == null)
      return;
    int lo = 0, hi = route.length - 1;
    while (lo + 1 < hi) {
      int mid = (lo + hi) / 2;
      if (route[mid][0] > at)
        hi = mid;
      else
        lo = mid;
    }
    double[] a = route[lo], b = route[hi];
    double t = Math.max(0, Math.min(1, (at - a[0]) / Math.max(1, b[0] - a[0])));
    x = a[1] + (b[1] - a[1]) * t;
    y = a[2] + (b[2] - a[2]) * t;
    dx = b[1] - a[1];
    dy = b[2] - a[2];
    if (follow) {
      centerX = x;
      centerY = y;
    }
    invalidate();
  }
  void setExpanded(boolean value) {
    expanded = value;
    drawn = "";
    if (value)
      fitTrip();
    else {
      span = 450000;
      follow = true;
      update(position);
    }
  }
  void fitTrip() {
    if (atlas == null)
      return;
    JSONArray b = atlas.optJSONArray("bounds");
    centerX = (b.optDouble(0) + b.optDouble(2)) / 2;
    centerY = (b.optDouble(1) + b.optDouble(3)) / 2;
    span = Math.max(b.optDouble(2) - b.optDouble(0),
                    (b.optDouble(3) - b.optDouble(1)) * 1.65) *
           1.15;
    follow = false;
    drawn = "";
    invalidate();
  }
  double height(double x, double y) {
    double px = (x - x0) / cell, py = (y - y0) / cell;
    if (px < 0 || py < 0 || px >= gridW - 1 || py >= gridH - 1)
      return 0;
    int ix = (int)px, iy = (int)py, k = iy * gridW + ix;
    double a = px - ix, b = py - iy;
    return (heights[k] * (1 - a) + heights[k + 1] * a) * (1 - b) +
        (heights[k + gridW] * (1 - a) + heights[k + gridW + 1] * a) * b;
  }
  float px(double value, int w) {
    return (float)((value - centerX) * w / span + w / 2.0);
  }
  float py(double value, int w, int h) {
    return (float)((centerY - value) * w / span + h / 2.0);
  }
  void triangle(Canvas c, double ax, double ay, double bx, double by, double cx,
                double cy, int w, int h) {
    double az = height(ax, ay), bz = height(bx, by), cz = height(cx, cy),
           mean = (az + bz + cz) / 3;
    double ux = bx - ax, uy = by - ay, uz = (bz - az) * 5, vx = cx - ax,
           vy = cy - ay, vz = (cz - az) * 5;
    double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz,
           nz = ux * vy - uy * vx;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    double shade =
        Math.round(
            Math.max(.1,
                     Math.min(1, (-.45 * nx + .45 * ny + .77 * nz) /
                                     Math.max(1, Math.sqrt(nx * nx + ny * ny +
                                                           nz * nz)))) *
            7) /
        7.0;
    int[] rgb = mean < 0      ? new int[] {155, 177, 168}
                : mean < 400  ? new int[] {177, 185, 142}
                : mean < 1200 ? new int[] {188, 184, 139}
                : mean < 2300 ? new int[] {186, 170, 129}
                : mean < 3100 ? new int[] {169, 157, 127}
                              : new int[] {196, 190, 167};
    double light = .77 + shade * .28;
    paint.setColor(Color.rgb((int)Math.round(rgb[0] * light),
                             (int)Math.round(rgb[1] * light),
                             (int)Math.round(rgb[2] * light)));
    Path p = new Path();
    p.moveTo(px(ax, w), py(ay, w, h));
    p.lineTo(px(bx, w), py(by, w, h));
    p.lineTo(px(cx, w), py(cy, w, h));
    p.close();
    paint.setStyle(Paint.Style.FILL);
    c.drawPath(p, paint);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(.55f);
    c.drawPath(p, paint);
    paint.setStyle(Paint.Style.FILL);
  }
  void renderBackdrop(int w, int h) {
    if (backdrop != null)
      backdrop.recycle();
    backdrop = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
    Canvas c = new Canvas(backdrop);
    c.drawColor(0xffa9b7ac);
    double left = centerX - span / 2, top = centerY + h * span / w / 2;
    double step = Math.pow(
        2, Math.round(Math.log(span / (expanded ? 28 : 16)) / Math.log(2)));
    for (double yy = Math.floor((top - h * span / w) / step) * step;
         yy < top + step; yy += step)
      for (double xx = Math.floor(left / step) * step; xx < left + span + step;
           xx += step) {
        if (((Math.round(xx / step) + Math.round(yy / step)) & 1) != 0) {
          triangle(c, xx, yy, xx + step, yy, xx, yy + step, w, h);
          triangle(c, xx + step, yy, xx + step, yy + step, xx, yy + step, w, h);
        } else {
          triangle(c, xx, yy, xx + step, yy, xx + step, yy + step, w, h);
          triangle(c, xx, yy, xx + step, yy + step, xx, yy + step, w, h);
        }
      }
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(.8f);
    paint.setColor(0xff66745e);
    paint.setPathEffect(new DashPathEffect(new float[] {4, 3}, 0));
    for (int i = 0; i < states.length(); i++) {
      JSONArray rings = states.optJSONObject(i).optJSONArray("rings");
      for (int j = 0; j < rings.length(); j++) {
        JSONArray ring = rings.optJSONArray(j);
        Path p = new Path();
        for (int k = 0; k < ring.length(); k++) {
          JSONArray v = ring.optJSONArray(k);
          float a = px(v.optDouble(0), w), b = py(v.optDouble(1), w, h);
          if (k == 0)
            p.moveTo(a, b);
          else
            p.lineTo(a, b);
        }
        c.drawPath(p, paint);
      }
    }
    paint.setPathEffect(null);
    paint.setColor(0xff927154);
    paint.setStrokeWidth(1);
    Path road = new Path();
    float lastX = -99999, lastY = -99999;
    for (int i = 0; i < route.length; i++) {
      float a = px(route[i][1], w), b = py(route[i][2], w, h);
      if (i == 0)
        road.moveTo(a, b);
      else if (Math.abs(a - lastX) + Math.abs(b - lastY) > .8f)
        road.lineTo(a, b);
      else
        continue;
      lastX = a;
      lastY = b;
    }
    c.drawPath(road, paint);
    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(Typeface.MONOSPACE);
    paint.setTextAlign(Paint.Align.CENTER);
    paint.setTextSize(expanded ? 7 : 5);
    paint.setColor(0xff526149);
    for (int i = 0; i < states.length(); i++) {
      JSONObject state = states.optJSONObject(i);
      JSONArray label = state.optJSONArray("label");
      float a = px(label.optDouble(0), w), b = py(label.optDouble(1), w, h);
      if (a > 12 && a < w - 12 && b > 8 && b < h - 8)
        c.drawText(state.optString("code"), a, b, paint);
    }
    if (expanded) {
      paint.setTextSize(6);
      paint.setColor(0xff665d49);
      for (int i = 0; i < stops.length(); i++) {
        JSONObject stop = stops.optJSONObject(i);
        String name = stop.optString("name");
        if (!name.matches(".*(Milpitas|Las Vegas|Albuquerque|Denton).*"))
          continue;
        JSONArray xy = stop.optJSONArray("xy");
        float a = px(xy.optDouble(0), w), b = py(xy.optDouble(1), w, h);
        c.drawRect(a - 1, b - 1, a + 2, b + 2, paint);
        paint.setTextAlign(a > w - 90 ? Paint.Align.RIGHT : Paint.Align.LEFT);
        c.drawText(name.split(",")[0], a + (a > w - 90 ? -5 : 5), b - 6, paint);
      }
    }
  }
  protected void onDraw(Canvas canvas) {
    if (atlas == null) {
      canvas.drawColor(0xffb1b98e);
      return;
    }
    int w = Math.max(1, getWidth() / 2), h = Math.max(1, getHeight() / 2);
    String key = w + ":" + h + ":" + span + ":" +
                 Math.round(centerX / (span / w / 4)) + ":" +
                 Math.round(centerY / (span / w / 4));
    if (!key.equals(drawn)) {
      renderBackdrop(w, h);
      drawn = key;
    }
    canvas.save();
    canvas.scale(2, 2);
    paint.setFilterBitmap(false);
    canvas.drawBitmap(backdrop, 0, 0, paint);
    float a = px(x, w), b = py(y, w, h);
    canvas.save();
    canvas.translate(Math.round(a), Math.round(b));
    canvas.rotate((float)(Math.atan2(dx, dy) * 180 / Math.PI));
    canvas.scale(.6f, .6f);
    paint.setColor(0xff363d36);
    canvas.drawRect(-4, -4, 5, 7, paint);
    paint.setColor(0xfff5f2df);
    canvas.drawRect(-3, -7, 4, 9, paint);
    paint.setColor(0xff758b8e);
    canvas.drawRect(-2, -3, 3, 0, paint);
    canvas.drawRect(-2, 4, 3, 6, paint);
    canvas.restore();
    paint.setColor(0xff40513e);
    paint.setTypeface(Typeface.MONOSPACE);
    paint.setTextSize(6);
    paint.setTextAlign(Paint.Align.CENTER);
    canvas.drawText("N", 9, 11, paint);
    Path north = new Path();
    north.moveTo(9, 13);
    north.lineTo(7, 17);
    north.lineTo(11, 17);
    north.close();
    canvas.drawPath(north, paint);
    double target = span * .23 / 1609.344,
           power = Math.pow(10, Math.floor(Math.log10(target))), miles = power;
    for (int n : new int[] {1, 2, 5})
      if (n * power <= target)
        miles = n * power;
    float len = (float)(miles * 1609.344 / span * w);
    paint.setStrokeWidth(1);
    canvas.drawLine(6, h - 6, 6 + len, h - 6, paint);
    canvas.drawLine(6, h - 8, 6, h - 6, paint);
    canvas.drawLine(6 + len, h - 8, 6 + len, h - 6, paint);
    paint.setTextSize(5);
    paint.setTextAlign(Paint.Align.LEFT);
    canvas.drawText(String.format(java.util.Locale.US, "%.0f mi", miles), 6,
                    h - 11, paint);
    if (expanded) {
      paint.setColor(0xffece3c9);
      canvas.drawRect(w - 75, h - 19, w - 4, h - 3, paint);
      paint.setColor(0xff3c4138);
      paint.setTextSize(10);
      canvas.drawText("T  ◎  −  +", w - 72, h - 7, paint);
    }
    canvas.restore();
  }
  public boolean onTouchEvent(MotionEvent e) {
    if (e.getAction() == MotionEvent.ACTION_DOWN) {
      touchX = e.getX();
      touchY = e.getY();
      startX = centerX;
      startY = centerY;
      moved = false;
      return true;
    }
    if (e.getAction() == MotionEvent.ACTION_MOVE && expanded) {
      float dx = e.getX() - touchX, dy = e.getY() - touchY;
      if (Math.abs(dx) + Math.abs(dy) > 4)
        moved = true;
      if (moved) {
        follow = false;
        centerX = startX - dx * span / getWidth();
        centerY = startY + dy * span / getWidth();
        invalidate();
      }
      return true;
    }
    if (e.getAction() == MotionEvent.ACTION_UP) {
      if (!expanded) {
        if (expand != null)
          expand.run();
      } else if (!moved && e.getY() > getHeight() - 40 &&
                 e.getX() > getWidth() - 154) {
        float fromRight = getWidth() - e.getX();
        if (fromRight < 42)
          span = Math.max(600, span * .65);
        else if (fromRight < 78)
          span = Math.min(3400000, span / .65);
        else if (fromRight < 114) {
          follow = true;
          span = 180000;
          update(position);
        } else
          fitTrip();
        drawn = "";
        invalidate();
      }
      return true;
    }
    return true;
  }
}
