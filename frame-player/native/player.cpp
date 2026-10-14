#include <GLES2/gl2.h>
#include <algorithm>
#include <android/log.h>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <jni.h>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <zlib.h>
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#include "json.hpp"
#include "meshoptimizer/meshoptimizer.h"
#include "stb_image.h"
using nlohmann::json;
using Clock = std::chrono::steady_clock;
static void log(const std::string &s) {
  __android_log_print(ANDROID_LOG_INFO, "FrameNative", "%s", s.c_str());
}
struct V {
  float x, y, z;
  V operator+(V b) const { return {x + b.x, y + b.y, z + b.z}; }
  V operator-(V b) const { return {x - b.x, y - b.y, z - b.z}; }
  V operator*(float b) const { return {x * b, y * b, z * b}; }
};
static float dot(V a, V b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V cross(V a, V b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
static V unit(V a) { return a * (1 / std::max(.00001f, std::sqrt(dot(a, a)))); }
struct Mat {
  float m[16]{};
};
static Mat multiply(const Mat &a, const Mat &b) {
  Mat r;
  for (int c = 0; c < 4; c++)
    for (int row = 0; row < 4; row++)
      for (int k = 0; k < 4; k++)
        r.m[c * 4 + row] += a.m[k * 4 + row] * b.m[c * 4 + k];
  return r;
}
static Mat look(V p, V at) {
  V f = unit(at - p), r = unit(cross(f, {0, 1, 0})), u = cross(r, f);
  Mat m;
  float v[] = {r.x, u.x, -f.x, 0, r.y,        u.y,        -f.y,      0,
               r.z, u.z, -f.z, 0, -dot(r, p), -dot(u, p), dot(f, p), 1};
  memcpy(m.m, v, sizeof(v));
  return m;
}
static Mat projection(float aspect) {
  Mat m;
  float f = 1 / tanf(64 * 3.14159265f / 360), zNear = 2.f, zFar = 45000;
  m.m[0] = f / aspect;
  m.m[5] = f;
  m.m[10] = (zFar + zNear) / (zNear - zFar);
  m.m[11] = -1;
  m.m[14] = 2 * zFar * zNear / (zNear - zFar);
  return m;
}
static std::string root;
static std::vector<unsigned char> readFile(const std::string &name) {
  std::ifstream f(root + "/" + name, std::ios::binary | std::ios::ate);
  if (f) {
    auto n = f.tellg();
    if (n < 0 || n > 1024LL * 1024 * 1024)
      throw std::runtime_error("Invalid file size");
    std::vector<unsigned char> b((size_t)n);
    f.seekg(0);
    f.read((char *)b.data(), n);
    if (!f)
      throw std::runtime_error("Short read: " + name);
    return b;
  }
  throw std::runtime_error("Missing local asset: " + name);
}
struct Reader {
  gzFile file;
  explicit Reader(const std::string &name) {
    file = gzopen((root + "/" + name).c_str(), "rb");
    if (!file)
      throw std::runtime_error("Missing local asset: " + name);
  }
  ~Reader() { gzclose(file); }
  void take(void *p, size_t n) {
    if (gzread(file, p, n) != (int)n)
      throw std::runtime_error("Truncated or invalid compressed scene");
  }
  uint32_t u() {
    uint32_t v;
    take(&v, 4);
    return v;
  }
  float f() {
    float v;
    take(&v, 4);
    return v;
  }
  void finish() {
    char byte;
    int n = gzread(file, &byte, 1);
    if (n != 0)
      throw std::runtime_error("Invalid scene trailer");
  }
};
struct Material {
  std::string texture;
  float color[3], alpha, offset, opacity, range;
  bool unlit, two, lines;
  GLuint tex = 0;
};
struct Mesh {
  uint32_t material, nv, ni, lod1, lod2;
  float sphere[4], origin[3], scale[3];
  std::vector<unsigned char> vertices;
  std::vector<uint16_t> indices;
  GLuint vb = 0, ib = 0;
};
struct Route {
  float s, x, y, z, width;
};
struct Picture {
  int w, h;
  std::vector<unsigned char> rgba;
};
struct Chunk {
  std::string id;
  std::vector<Material> materials;
  std::vector<Mesh> meshes;
  std::vector<Route> route;
  std::map<std::string, Picture> pictures;
};
static std::unique_ptr<Chunk> loadChunk(const std::string &id) {
  Reader r("chunks/" + id + ".frm.gz");
  char magic[4];
  r.take(magic, 4);
  if (memcmp(magic, "FRM4", 4))
    throw std::runtime_error("Invalid scene format");
  uint32_t bytes = r.u(), meshes = r.u(), routes = r.u();
  if (bytes > 10000000 || meshes > 100000 || routes > 1000000)
    throw std::runtime_error("Invalid scene counts");
  std::string text(bytes, '\0');
  r.take(&text[0], bytes);
  auto c = std::unique_ptr<Chunk>(new Chunk);
  c->id = id;
  for (const auto &j : json::parse(text)) {
    Material m{};
    m.texture = j["texture"].get<std::string>();
    for (int i = 0; i < 3; i++)
      m.color[i] = j["color"][i];
    m.alpha = j["alpha"];
    m.offset = j["offset"];
    m.opacity = j["opacity"];
    m.range = j["range"];
    m.unlit = j["unlit"];
    m.two = j["double"];
    m.lines = j["lines"];
    c->materials.push_back(m);
  }
  c->route.resize(routes);
  r.take(c->route.data(), routes * sizeof(Route));
  for (uint32_t i = 0; i < meshes; i++) {
    Mesh m{};
    m.material = r.u();
    m.nv = r.u();
    m.ni = r.u();
    m.lod1 = r.u();
    m.lod2 = r.u();
    if (m.material >= c->materials.size() || m.nv > 65535 || m.ni > 10000000)
      throw std::runtime_error("Invalid mesh");
    r.take(m.sphere, 16);
    r.take(m.origin, 12);
    r.take(m.scale, 12);
    m.vertices.resize(m.nv * 20);
    m.indices.resize(m.ni);
    r.take(m.vertices.data(), m.vertices.size());
    r.take(m.indices.data(), m.ni * 2);
    if (m.lod2 > m.lod1 || m.lod1 > m.ni)
      throw std::runtime_error("Invalid detail ranges");
    for (auto index : m.indices)
      if (index >= m.nv)
        throw std::runtime_error("Invalid vertex index");
    if (!c->materials[m.material].lines) {
      uint32_t ends[] = {0, m.lod2, m.lod1, m.ni};
      for (int k = 0; k < 3; k++)
        if (ends[k + 1] > ends[k])
          meshopt_optimizeVertexCache(m.indices.data() + ends[k],
                                      m.indices.data() + ends[k],
                                      ends[k + 1] - ends[k], m.nv);
      m.nv = meshopt_optimizeVertexFetch(m.vertices.data(), m.indices.data(),
                                         m.ni, m.vertices.data(), m.nv, 20);
      m.vertices.resize(m.nv * 20);
    }
    c->meshes.push_back(std::move(m));
  }
  r.finish();
  for (const auto &m : c->materials)
    if (!m.texture.empty() && !c->pictures.count(m.texture)) {
      auto b = readFile("textures/" + m.texture);
      Picture p{};
      int channels;
      unsigned char *pixels =
          stbi_load_from_memory(b.data(), b.size(), &p.w, &p.h, &channels, 4);
      if (!pixels)
        throw std::runtime_error("Cannot decode texture " + m.texture);
      p.rgba.assign(pixels, pixels + p.w * p.h * 4);
      stbi_image_free(pixels);
      c->pictures.emplace(m.texture, std::move(p));
    }
  return c;
}
struct Texture {
  GLuint id;
  int refs;
};
static std::map<std::string, Texture> textures;
static GLuint white = 0;
static void upload(Chunk &c) {
  for (auto &m : c.materials) {
    if (m.texture.empty()) {
      m.tex = white;
      continue;
    }
    auto it = textures.find(m.texture);
    if (it == textures.end()) {
      auto &p = c.pictures.at(m.texture);
      GLuint id;
      glGenTextures(1, &id);
      glBindTexture(GL_TEXTURE_2D, id);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, p.w, p.h, 0, GL_RGBA,
                   GL_UNSIGNED_BYTE, p.rgba.data());
      it = textures.emplace(m.texture, Texture{id, 0}).first;
    }
    it->second.refs++;
    m.tex = it->second.id;
  }
  c.pictures.clear();
  for (auto &m : c.meshes) {
    glGenBuffers(1, &m.vb);
    glBindBuffer(GL_ARRAY_BUFFER, m.vb);
    glBufferData(GL_ARRAY_BUFFER, m.vertices.size(), m.vertices.data(),
                 GL_STATIC_DRAW);
    glGenBuffers(1, &m.ib);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m.ib);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, m.indices.size() * 2,
                 m.indices.data(), GL_STATIC_DRAW);
    std::vector<unsigned char>().swap(m.vertices);
    std::vector<uint16_t>().swap(m.indices);
  }
}
static void release(Chunk &c) {
  for (auto &m : c.meshes) {
    glDeleteBuffers(1, &m.vb);
    glDeleteBuffers(1, &m.ib);
  }
  for (auto &m : c.materials)
    if (!m.texture.empty()) {
      auto it = textures.find(m.texture);
      if (it != textures.end() && !--it->second.refs) {
        glDeleteTextures(1, &it->second.id);
        textures.erase(it);
      }
    }
}
struct Segment {
  std::string source;
  double at, start, end, length;
};
static std::vector<Segment> segments;
static json journey;
static double total = 1, position = 0;
static const Segment &locate(double at) {
  size_t lo = 0, hi = segments.size();
  while (lo + 1 < hi) {
    size_t mid = (lo + hi) / 2;
    if (segments[mid].at <= at)
      lo = mid;
    else
      hi = mid;
  }
  return segments[lo];
}
static std::string chunkId(double at) {
  const auto &s = locate(at);
  int c = (int)((s.start + at - s.at) / 10000);
  std::string name = s.source.empty() ? "main" : s.source;
  std::replace(name.begin(), name.end(), '/', '_');
  char end[30];
  snprintf(end, sizeof(end), "_%04d", c);
  return name + end;
}
static std::mutex mutex;
static std::unique_ptr<Chunk> result, active, next;
static bool busy = false;
static std::string requested, error, failed;
static Clock::time_point retryAt;
static void request(const std::string &id) {
  std::lock_guard<std::mutex> lock(mutex);
  if (busy || result || (id == failed && Clock::now() < retryAt))
    return;
  busy = true;
  requested = id;
  std::thread([id]() {
    try {
      auto c = loadChunk(id);
      std::lock_guard<std::mutex> lock(mutex);
      result = std::move(c);
      busy = false;
      error.clear();
      failed.clear();
    } catch (const std::exception &e) {
      std::lock_guard<std::mutex> lock(mutex);
      error = e.what();
      busy = false;
      failed = id;
      retryAt = Clock::now() + std::chrono::seconds(5);
      log(error);
    }
  }).detach();
}
static Route routeAt(const Chunk &c, double s) {
  const auto &ps = c.route;
  size_t lo = 0, hi = ps.size() - 1;
  while (lo + 1 < hi) {
    size_t mid = (lo + hi) / 2;
    if (ps[mid].s > s)
      hi = mid;
    else
      lo = mid;
  }
  const auto &a = ps[lo];
  const auto &b = ps[hi];
  float t = std::max(
      0.f, std::min(1.f, float((s - a.s) / std::max(.001f, b.s - a.s))));
  return {float(s), a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t, a.width + (b.width - a.width) * t};
}
static GLuint compile(GLenum type, const char *s) {
  GLuint id = glCreateShader(type);
  glShaderSource(id, 1, &s, nullptr);
  glCompileShader(id);
  GLint ok;
  glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char e[2048];
    glGetShaderInfoLog(id, sizeof(e), nullptr, e);
    throw std::runtime_error(e);
  }
  return id;
}
static GLuint program(const char *v, const char *f) {
  GLuint vs = compile(GL_VERTEX_SHADER, v), fs = compile(GL_FRAGMENT_SHADER, f),
         p = glCreateProgram();
  glAttachShader(p, vs);
  glAttachShader(p, fs);
  glBindAttribLocation(p, 0, "aPosition");
  glBindAttribLocation(p, 1, "aNormal");
  glBindAttribLocation(p, 2, "aColor");
  glBindAttribLocation(p, 3, "aUV");
  glLinkProgram(p);
  glDeleteShader(vs);
  glDeleteShader(fs);
  GLint ok;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok)
    throw std::runtime_error("Shader link failed");
  return p;
}
struct ScenePass {
  GLuint id;
  GLint mvp, alpha;
};
static ScenePass solidPass, texturePass, cutoutPass;
static GLuint screenProgram, fbo = 0, target = 0, depth = 0, quad = 0;
static GLint screenMode;
static int width = 1366, height = 768, rw = 342, rh = 192;
static Mat projectionMatrix;
static const char *vertex =
    R"(attribute vec3 aPosition;attribute vec4 aColor;attribute vec2 aUV;uniform mat4 uMVP;varying vec4 vColor;varying vec2 vUV;varying float vFog;void main(){gl_Position=uMVP*vec4(aPosition,1.0);vColor=aColor;vUV=aUV;vFog=min(1.0,max(0.0,gl_Position.w)*.000035);vFog*=vFog;})";
static const char *fragment =
    R"(precision mediump float;varying vec4 vColor;varying vec2 vUV;varying float vFog;uniform sampler2D uMap;uniform float uAlpha;uniform vec3 uFog;void main(){vec4 tex=texture2D(uMap,vUV);if(tex.a<uAlpha)discard;gl_FragColor=vec4(mix(tex.rgb*vColor.rgb,uFog,vFog),1.0);})";
static const char *solidFragment =
    R"(precision mediump float;varying vec4 vColor;varying float vFog;uniform vec3 uFog;void main(){gl_FragColor=vec4(mix(vColor.rgb,uFog,vFog),1.0);})";
static const char *textureFragment =
    R"(precision mediump float;varying vec4 vColor;varying vec2 vUV;varying float vFog;uniform sampler2D uMap;uniform vec3 uFog;void main(){gl_FragColor=vec4(mix(texture2D(uMap,vUV).rgb*vColor.rgb,uFog,vFog),1.0);})";
static ScenePass makePass(const char *source) {
  ScenePass p;
  p.id = program(vertex, source);
  p.mvp = glGetUniformLocation(p.id, "uMVP");
  p.alpha = glGetUniformLocation(p.id, "uAlpha");
  glUseProgram(p.id);
  glUniform3f(glGetUniformLocation(p.id, "uFog"), .84, .86, .85);
  glUniform1i(glGetUniformLocation(p.id, "uMap"), 0);
  return p;
}
static const char *screenV =
    R"(attribute vec3 aPosition;varying vec2 uv;void main(){gl_Position=vec4(aPosition,1.0);uv=aPosition.xy*.5+.5;})";
static const char *screenF =
    R"(precision mediump float;varying vec2 uv;uniform sampler2D uMap;uniform float uMode;void main(){if(uMode>.5){vec3 horizon=vec3(.84,.86,.85),sky=vec3(.57,.71,.82);gl_FragColor=vec4(mix(horizon,sky,smoothstep(.38,1.0,uv.y)),1.0);}else gl_FragColor=texture2D(uMap,uv);})";
static void screen(float mode) {
  glUseProgram(screenProgram);
  glUniform1f(screenMode, mode);
  glBindBuffer(GL_ARRAY_BUFFER, quad);
  glEnableVertexAttribArray(0);
  for (int i = 1; i < 4; i++)
    glDisableVertexAttribArray(i);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 12, nullptr);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}
static Clock::time_point last, reportAt;
static int frames = 0, draws = 0, triangles = 0;
static float fps = 0;
static bool paused = false;
extern "C" JNIEXPORT void JNICALL Java_in_scogg_frame_NativeArt_init(
    JNIEnv *env, jclass, jstring dir, jdouble start) {
  try {
    active.reset();
    next.reset();
    textures.clear();
    fbo = target = depth = quad = 0;
    paused = false;
    frames = 0;
    const char *s = env->GetStringUTFChars(dir, nullptr);
    root = s;
    env->ReleaseStringUTFChars(dir, s);
    stbi_set_flip_vertically_on_load(1);
    auto b = readFile("journey.json");
    journey = json::parse(b);
    total = journey["total"];
    position = fmod(std::max(0.0, (double)start), total);
    segments.clear();
    for (const auto &j : journey["segments"])
      segments.push_back(
          {j["source"], j["at"], j["start"], j["end"], j["length"]});
    solidPass = makePass(solidFragment);
    texturePass = makePass(textureFragment);
    cutoutPass = makePass(fragment);
    screenProgram = program(screenV, screenF);
    screenMode = glGetUniformLocation(screenProgram, "uMode");
    glUseProgram(screenProgram);
    glUniform1i(glGetUniformLocation(screenProgram, "uMap"), 0);
    glGenTextures(1, &white);
    glBindTexture(GL_TEXTURE_2D, white);
    unsigned char pixel[4] = {255, 255, 255, 255};
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                 pixel);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    float q[] = {-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0};
    glGenBuffers(1, &quad);
    glBindBuffer(GL_ARRAY_BUFFER, quad);
    glBufferData(GL_ARRAY_BUFFER, sizeof(q), q, GL_STATIC_DRAW);
    last = reportAt = Clock::now();
    request(chunkId(position));
    log("Native GLES2 initialized");
  } catch (const std::exception &e) {
    error = e.what();
    log(error);
  }
}
extern "C" JNIEXPORT void JNICALL Java_in_scogg_frame_NativeArt_resize(JNIEnv *,
                                                                       jclass,
                                                                       jint w,
                                                                       jint h) {
  width = w;
  height = h;
  rw = (w + 3) / 4;
  rh = (h + 3) / 4;
  projectionMatrix = projection((float)rw / rh);
  if (fbo)
    glDeleteFramebuffers(1, &fbo);
  if (target)
    glDeleteTextures(1, &target);
  if (depth)
    glDeleteRenderbuffers(1, &depth);
  glGenTextures(1, &target);
  glBindTexture(GL_TEXTURE_2D, target);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, rw, rh, 0, GL_RGBA, GL_UNSIGNED_BYTE,
               nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glGenRenderbuffers(1, &depth);
  glBindRenderbuffer(GL_RENDERBUFFER, depth);
  glRenderbufferStorage(GL_RENDERBUFFER, 0x81A6, rw, rh);
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                         target, 0);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
                            GL_RENDERBUFFER, depth);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    error = "Framebuffer unavailable";
    log(error);
  }
}
extern "C" JNIEXPORT void JNICALL Java_in_scogg_frame_NativeArt_frame(JNIEnv *,
                                                                      jclass) {
  auto now = Clock::now();
  double dt = std::min(.1, std::chrono::duration<double>(now - last).count());
  last = now;
  if (segments.empty())
    return;
  {
    std::lock_guard<std::mutex> lock(mutex);
    if (result) {
      upload(*result);
      if (next)
        release(*next);
      next = std::move(result);
    }
  }
  auto id = chunkId(position);
  if (next && next->id == id) {
    if (active)
      release(*active);
    active = std::move(next);
    log("Showing " + id);
  }
  if (!active || active->id != id) {
    request(id);
    return;
  }
  if (!paused) {
    double candidate = fmod(position + dt * 96.56 / 3.6, total);
    auto cid = chunkId(candidate);
    if (cid == active->id)
      position = candidate;
    else if (next && next->id == cid) {
      release(*active);
      active = std::move(next);
      position = candidate;
      log("Showing " + cid);
    }
  }
  const auto &segment = locate(position);
  double local = segment.start + position - segment.at;
  Route p = routeAt(*active, local),
        before = routeAt(*active, std::max(0.0, local - 3)),
        after = routeAt(*active, local + 9);
  float dx = after.x - before.x, dy = after.y - before.y,
        n = std::max(.001f, std::hypot(dx, dy));
  dx /= n;
  dy /= n;
  float lane = std::min(p.width / 4, 2.6f),
        slope = std::max(-.5f,
                         std::min(.5f, (after.z - before.z) /
                                           std::max(1.f, after.s - before.s)));
  V eye{p.x + dy * lane, p.z + 1.8f, -p.y + dx * lane},
      at = eye + V{dx * 80, slope * 80 - 1.5f, -dy * 80};
  Mat vp = multiply(projectionMatrix, look(eye, at));
  float planes[6][4];
  for (int i = 0; i < 6; i++) {
    int row = i / 2;
    float sign = i % 2 ? -1.f : 1.f, len = 0;
    for (int k = 0; k < 4; k++)
      planes[i][k] = vp.m[k * 4 + 3] + sign * vp.m[k * 4 + row];
    for (int k = 0; k < 3; k++)
      len += planes[i][k] * planes[i][k];
    len = sqrtf(len);
    for (int k = 0; k < 4; k++)
      planes[i][k] /= len;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glViewport(0, 0, rw, rh);
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_CULL_FACE);
  glClear(GL_DEPTH_BUFFER_BIT);
  screen(1);
  glEnable(GL_DEPTH_TEST);
  glDepthFunc(GL_LEQUAL);
  for (int i = 0; i < 4; i++)
    glEnableVertexAttribArray(i);
  draws = triangles = 0;
  int material = -1;
  ScenePass *pass = nullptr;
  for (auto &m : active->meshes) {
    bool visible = true;
    for (auto &plane : planes)
      if (plane[0] * m.sphere[0] + plane[1] * m.sphere[1] +
              plane[2] * m.sphere[2] + plane[3] <
          -m.sphere[3]) {
        visible = false;
        break;
      }
    if (!visible)
      continue;
    auto &mat = active->materials[m.material];
    float distance = std::hypot(m.sphere[0] - eye.x, m.sphere[2] - eye.z);
    if (distance > (mat.lines           ? 200
                    : mat.range < 45000 ? std::min(mat.range, 1000.f)
                                        : mat.range) +
                       m.sphere[3])
      continue;
    if (material != (int)m.material) {
      material = m.material;
      glBindTexture(GL_TEXTURE_2D, mat.tex);
      pass = mat.texture.empty() ? &solidPass
             : mat.alpha > 0     ? &cutoutPass
                                 : &texturePass;
      glUseProgram(pass->id);
      if (pass->alpha >= 0)
        glUniform1f(pass->alpha, mat.alpha);
      if (mat.two)
        glDisable(GL_CULL_FACE);
      else {
        glEnable(GL_CULL_FACE);
        glCullFace(GL_BACK);
      }
      if (mat.offset) {
        glEnable(GL_POLYGON_OFFSET_FILL);
        glPolygonOffset(mat.offset, mat.offset);
      } else
        glDisable(GL_POLYGON_OFFSET_FILL);
    }
    Mat model;
    model.m[0] = m.scale[0];
    model.m[5] = m.scale[1];
    model.m[10] = m.scale[2];
    model.m[12] = m.origin[0];
    model.m[13] = m.origin[1];
    model.m[14] = m.origin[2];
    model.m[15] = 1;
    Mat mvp = multiply(vp, model);
    glUniformMatrix4fv(pass->mvp, 1, GL_FALSE, mvp.m);
    glBindBuffer(GL_ARRAY_BUFFER, m.vb);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m.ib);
    glVertexAttribPointer(0, 3, GL_UNSIGNED_SHORT, GL_FALSE, 20, (void *)0);
    glDisableVertexAttribArray(1);
    glVertexAttribPointer(2, 4, GL_UNSIGNED_BYTE, GL_TRUE, 20, (void *)8);
    glVertexAttribPointer(3, 2, GL_FLOAT, GL_FALSE, 20, (void *)12);
    int count = distance > 500 ? m.lod2 : distance > 200 ? m.lod1 : m.ni;
    glDrawElements(mat.lines ? GL_LINES : GL_TRIANGLES, count,
                   GL_UNSIGNED_SHORT, nullptr);
    draws++;
    if (!mat.lines)
      triangles += count / 3;
  }
  glDisable(GL_POLYGON_OFFSET_FILL);
  glDisable(GL_CULL_FACE);
  glDisable(GL_DEPTH_TEST);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(0, 0, width, height);
  glBindTexture(GL_TEXTURE_2D, target);
  screen(0);
  frames++;
  double elapsed = std::chrono::duration<double>(now - reportAt).count();
  if (elapsed > 10) {
    fps = frames / elapsed;
    frames = 0;
    reportAt = now;
    char report[200];
    snprintf(report, sizeof(report), "fps=%.1f km=%.3f draws=%d triangles=%d",
             fps, position / 1000, draws, triangles);
    log(report);
  }
  auto future = chunkId(fmod(position + 700, total));
  if (future != active->id && (!next || next->id != future))
    request(future);
}
extern "C" JNIEXPORT jdouble JNICALL
Java_in_scogg_frame_NativeArt_position(JNIEnv *, jclass) {
  return position;
}
extern "C" JNIEXPORT jstring JNICALL
Java_in_scogg_frame_NativeArt_status(JNIEnv *env, jclass) {
  std::string text;
  {
    std::lock_guard<std::mutex> lock(mutex);
    text = error;
  }
  if (text.empty()) {
    char b[150];
    snprintf(b, sizeof(b), "%.1f FPS · %.2f km · %d triangles", fps,
             position / 1000, triangles);
    text = b;
  }
  return env->NewStringUTF(text.c_str());
}
extern "C" JNIEXPORT void JNICALL Java_in_scogg_frame_NativeArt_pause(JNIEnv *,
                                                                      jclass) {
  paused = !paused;
}
extern "C" JNIEXPORT void JNICALL
Java_in_scogg_frame_NativeArt_seek(JNIEnv *, jclass, jdouble value) {
  position = fmod(std::max(0.0, (double)value), total);
}
extern "C" JNIEXPORT jstring JNICALL
Java_in_scogg_frame_NativeArt_caption(JNIEnv *env, jclass) {
  if (journey.is_null())
    return env->NewStringUTF("Loading local road data…");
  std::string previous = "", following = "", nearest = "";
  double delta = 1e20;
  for (const auto &stop : journey["stops"]) {
    double at = stop["at"];
    std::string name = stop["name"];
    double d = std::abs(at - position);
    if (d < delta) {
      delta = d;
      nearest = name;
    }
    if (at <= position)
      previous = name;
    else if (following.empty())
      following = name;
  }
  std::string text = delta < 4000 ? nearest : previous + " → " + following;
  return env->NewStringUTF(text.c_str());
}
