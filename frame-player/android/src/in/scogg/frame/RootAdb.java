package in.scogg.frame;
import java.io.*;
import java.net.*;
import java.nio.*;

/** Talks to the frame's existing, unauthenticated root adbd on loopback. */
final class RootAdb {
  static final int CNXN = 0x4e584e43, OPEN = 0x4e45504f, OKAY = 0x59414b4f,
                   WRTE = 0x45545257, CLSE = 0x45534c43;
  static void send(OutputStream out, int command, int a, int b, byte[] data)
      throws IOException {
    int sum = 0;
    for (byte v : data)
      sum += v & 255;
    ByteBuffer h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
    h.putInt(command)
        .putInt(a)
        .putInt(b)
        .putInt(data.length)
        .putInt(sum)
        .putInt(command ^ 0xffffffff);
    out.write(h.array());
    out.write(data);
    out.flush();
  }
  static byte[] read(InputStream in, int n) throws IOException {
    byte[] b = new byte[n];
    int at = 0, k;
    while (at < n) {
      k = in.read(b, at, n - at);
      if (k < 0)
        throw new EOFException();
      at += k;
    }
    return b;
  }
  static String run(String command) throws IOException {
    Socket socket = new Socket();
    socket.connect(new InetSocketAddress("127.0.0.1", 5555), 5000);
    socket.setSoTimeout(10000);
    try {
      InputStream in = socket.getInputStream();
      OutputStream out = socket.getOutputStream();
      send(out, CNXN, 0x01000000, 4096, "host::\0".getBytes("UTF-8"));
      StringBuilder text = new StringBuilder();
      for (int count = 0; count < 100; count++) {
        ByteBuffer h =
            ByteBuffer.wrap(read(in, 24)).order(ByteOrder.LITTLE_ENDIAN);
        int type = h.getInt(), a = h.getInt(), b = h.getInt(), len = h.getInt();
        if (len < 0 || len > 1024 * 1024)
          throw new IOException("ADB packet too large");
        byte[] data = read(in, len);
        if (type == CNXN)
          send(out, OPEN, 1, 0, ("shell:" + command + "\0").getBytes("UTF-8"));
        else if (type == WRTE) {
          text.append(new String(data, "UTF-8"));
          send(out, OKAY, 1, a, new byte[0]);
        } else if (type == CLSE) {
          send(out, CLSE, 1, a, new byte[0]);
          return text.toString();
        } else if (type != OKAY)
          throw new IOException("Unexpected ADB reply " + type);
      }
      throw new IOException("ADB command did not finish");
    } finally {
      socket.close();
    }
  }
}
