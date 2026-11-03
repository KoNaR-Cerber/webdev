#include "cerber_telemetry/parser.hpp"

#include <cmath>
#include <cstring>
#include <type_traits>

namespace cerber_telemetry {
using namespace QNX2ROSProtocol;

static_assert(sizeof(int) == 4 && sizeof(float) == 4 && sizeof(double) == 8,
              "Unsupported protocol scalar layout");
static_assert(sizeof(RobotState) == 208 && offsetof(RobotState, rpy) == 16 &&
              offsetof(RobotState, ultrasound) == 192,
              "RobotState must retain its original natural alignment");
static_assert(sizeof(RobotStateReceived) == 220 &&
              offsetof(RobotStateReceived, data) == 12, "Wrong robot frame layout");
static_assert(sizeof(LegacyQNX2ROSProtocol::RobotState) == 200 &&
              offsetof(LegacyQNX2ROSProtocol::RobotState, rpy) == 8 &&
              offsetof(LegacyQNX2ROSProtocol::RobotState, ultrasound) == 184,
              "Wrong legacy robot state layout");
static_assert(sizeof(LegacyQNX2ROSProtocol::RobotStateReceived) == 212 &&
              offsetof(LegacyQNX2ROSProtocol::RobotStateReceived, data) == 12,
              "Wrong legacy robot frame layout");
static_assert(sizeof(JointStateReceived) == 108 &&
              offsetof(JointStateReceived, data) == 12, "Wrong joint frame layout");
static_assert(sizeof(ImuDataReceived) == 52 &&
              offsetof(ImuDataReceived, data) == 12, "Wrong IMU frame layout");
static_assert(sizeof(HandleStateReceived) == 60 &&
              offsetof(HandleStateReceived, data) == 12, "Wrong handle frame layout");

bool little_endian_host() {
  const std::uint16_t value = 1;
  std::uint8_t first = 0;
  std::memcpy(&first, &value, 1);
  return first == 1;
}

template <typename T, std::size_t N>
bool all_finite(const T (&values)[N]) {
  for (const auto value : values) if (!std::isfinite(value)) return false;
  return true;
}

template <typename T>
bool valid_robot(const T &v) {
  return all_finite(v.rpy) && all_finite(v.rpy_vel) && all_finite(v.pos_world) &&
         all_finite(v.vel_body) && all_finite(v.ultrasound);
}
bool valid(const RobotState &v) { return valid_robot(v); }
bool valid(const LegacyQNX2ROSProtocol::RobotState &v) { return valid_robot(v); }
bool valid(const JointState &v) {
  const double values[] = {v.LF_Joint, v.LF_Joint_1, v.LF_Joint_2,
                          v.RF_Joint, v.RF_Joint_1, v.RF_Joint_2,
                          v.LB_Joint, v.LB_Joint_1, v.LB_Joint_2,
                          v.RB_Joint, v.RB_Joint_1, v.RB_Joint_2};
  return all_finite(values);
}
bool valid(const ImuData &v) {
  return all_finite(v.buffer_float);
}
bool valid(const HandleState &v) {
  const double values[] = {v.left_axis_forward, v.left_axis_side, v.right_axis_yaw,
                          v.goal_vel_forward, v.goal_vel_side, v.goal_vel_yaw};
  return all_finite(values);
}

template <typename Frame>
ParseResult parse_typed(const std::uint8_t *bytes, std::size_t length, std::int32_t code) {
  static_assert(std::is_trivially_copyable<Frame>::value, "Wire frame must be POD");
  ParseResult result;
  result.code = code;
  if (length != sizeof(Frame)) return result;
  using Data = decltype(Frame::data);
  if constexpr (std::is_same<Frame, RobotStateReceived>::value ||
                std::is_same<Frame, LegacyQNX2ROSProtocol::RobotStateReceived>::value) {
    // Vendor EthCommand defines field2 as parameter byte count for type1.
    // This also prevents a truncated220 frame from being accepted as legacy212.
    std::uint32_t parameters_size = 0, type_count = 0;
    std::memcpy(&parameters_size, bytes + 4, 4);
    std::memcpy(&type_count, bytes + 8, 4);
    if (parameters_size != sizeof(Data)) return result;
    if ((type_count & 0xffU) != 1U) {
      result.status = ParseStatus::invalid_header;
      return result;
    }
    // Reject invalid C++ bool object representations before constructing the
    // original struct. These three fields are not published.
    for (const std::size_t offset : {offsetof(Data, is_charging),
                                    offsetof(Data, is_robot_need_move),
                                    offsetof(Data, zero_position_flag)}) {
      if (bytes[offsetof(Frame, data) + offset] > 1) {
        result.status = ParseStatus::invalid_value;
        return result;
      }
    }
  }
  // Copy the payload directly into its naturally aligned type rather than
  // dereferencing an unaligned struct inside a UDP byte buffer.
  Data data{};
  std::memcpy(&data, bytes + offsetof(Frame, data), sizeof(Data));
  if (!valid(data)) {
    result.status = ParseStatus::invalid_value;
    return result;
  }
  result.status = ParseStatus::ok;
  result.payload = data;
  return result;
}

ParseResult parse_frame(const std::uint8_t *bytes, std::size_t length) {
  if (!bytes || length < 12) return {};
  std::int32_t code = 0;
  std::memcpy(&code, bytes, sizeof(code));
  switch (code) {
  case 2305:
    if (length == sizeof(LegacyQNX2ROSProtocol::RobotStateReceived))
      return parse_typed<LegacyQNX2ROSProtocol::RobotStateReceived>(bytes, length, code);
    return parse_typed<RobotStateReceived>(bytes, length, code);
  case 2306: return parse_typed<JointStateReceived>(bytes, length, code);
  case 0x010901: return parse_typed<ImuDataReceived>(bytes, length, code);
  case 2309: return parse_typed<HandleStateReceived>(bytes, length, code);
  default:
    ParseResult result;
    result.code = code;
    result.status = ParseStatus::unknown_code;
    return result;
  }
}
} // namespace cerber_telemetry
