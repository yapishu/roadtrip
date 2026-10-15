#include "../native/itinerary.h"
#include "../native/json.hpp"
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

static void check(bool condition, const std::string &message) {
  if (!condition)
    throw std::runtime_error(message);
}

int main(int argc, char **argv) {
  check(argc == 2, "Pass the repository journey.json");
  nlohmann::json journey;
  std::ifstream(argv[1]) >> journey;
  std::vector<Segment> segments;
  for (const auto &s : journey["segments"])
    segments.push_back(
        {s["source"], s["at"], s["start"], s["end"], s["length"]});

  // Enumerate each visited chunk interval, including partially traversed chunks
  // and return visits. Compare prefetch against the next interval in itinerary
  // order rather than a fixed-distance sample that can skip an interval.
  struct Visit {
    double start, end;
    std::string id;
  };
  std::vector<Visit> visits;
  for (const auto &s : segments) {
    for (int index = (int)(s.start / 10000); index * 10000.0 < s.end; ++index) {
      visits.push_back({s.at + std::max(s.start, index * 10000.0) - s.start,
                        s.at + std::min(s.end, (index + 1) * 10000.0) - s.start,
                        chunkName(s.source, index)});
    }
  }
  for (size_t i = 0; i < visits.size(); ++i) {
    const auto &v = visits[i];
    const auto &following = visits[(i + 1) % visits.size()];
    for (double fraction : {.01, .5, .99}) {
      double at = v.start + (v.end - v.start) * fraction;
      check(chunkId(segments, at) == v.id, "Current chunk " + v.id);
      auto next = nextChunk(segments, at);
      check(next.id == following.id,
            "Prefetch after " + v.id + " got " + next.id);
      check(std::abs(next.distance - (v.end - at)) < .00001,
            "Boundary distance " + v.id);
    }
  }

  double panguitch = 0;
  for (const auto &stop : journey["stops"])
    if (stop["name"] == "Panguitch, Utah")
      panguitch = stop["at"];
  check(panguitch > 0, "Panguitch stop");
  check(chunkId(segments, panguitch - .5) == "detours_brian-head_0011",
        "Detour exit");
  check(chunkId(segments, panguitch + 700) == "main_0197",
        "700 m skips the entry chunk");
  check(nextChunk(segments, panguitch - .5).id == "main_0196",
        "Load the 72 m entry");
  auto exit = nextChunk(segments, panguitch + 1);
  check(exit.id == "main_0197" && std::abs(exit.distance - 71) < .001,
        "Continue from the short entry chunk");

  std::vector<Segment> shortTrip{{"", 0, 0, 9950, 9950},
                                 {"detour", 9950, 9990, 10020, 30},
                                 {"", 9980, 9950, 20000, 10050}};
  check(nextChunk(shortTrip, 9900).id == "detour_0000", "Ten metre entry");
  check(nextChunk(shortTrip, 9955).id == "detour_0001", "Twenty metre exit");
  check(nextChunk(shortTrip, 9975).id == "main_0000",
        "Return to partial chunk");
  check(nextChunk(shortTrip, 20029).id == "main_0000", "Exact chunk-end loop");
  std::cout << "Passed " << visits.size()
            << " itinerary intervals, Panguitch's 72 m entry, short segments "
               "and loop\n";
}
