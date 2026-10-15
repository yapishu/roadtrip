#pragma once
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

struct Segment {
  std::string source;
  double at, start, end, length;
};

inline const Segment &locate(const std::vector<Segment> &segments, double at) {
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

inline std::string chunkName(const std::string &source, int index) {
  std::string name = source.empty() ? "main" : source;
  std::replace(name.begin(), name.end(), '/', '_');
  char suffix[30];
  snprintf(suffix, sizeof(suffix), "_%04d", index);
  return name + suffix;
}

inline std::string chunkId(const std::vector<Segment> &segments, double at) {
  const auto &s = locate(segments, at);
  return chunkName(s.source, (int)((s.start + at - s.at) / 10000));
}

struct ChunkBoundary {
  std::string id;
  double distance;
};

// Prefetch the immediately following chunk, including short source joins.
inline ChunkBoundary nextChunk(const std::vector<Segment> &segments,
                               double at) {
  const auto &s = locate(segments, at);
  int index = (int)((s.start + at - s.at) / 10000);
  double end = (index + 1) * 10000.0;
  if (end < s.end)
    return {chunkName(s.source, index + 1), s.at + end - s.start - at};
  const auto &following =
      segments[(&s - segments.data() + 1) % segments.size()];
  return {chunkName(following.source, (int)(following.start / 10000)),
          s.at + s.length - at};
}
