#pragma once

#include "cerber_telemetry/wire.hpp"
#include "cerber_telemetry/legacy_wire.hpp"
#include <cstddef>
#include <cstdint>
#include <variant>

namespace cerber_telemetry {
enum class ParseStatus { ok, unknown_code, wrong_length, invalid_value, invalid_header };
using Payload = std::variant<QNX2ROSProtocol::RobotState,
                             LegacyQNX2ROSProtocol::RobotState,
                             QNX2ROSProtocol::JointState,
                             QNX2ROSProtocol::ImuData,
                             QNX2ROSProtocol::HandleState>;
struct ParseResult {
  ParseStatus status = ParseStatus::wrong_length;
  std::int32_t code = 0;
  Payload payload{};
};

// Input is one complete datagram. Never call with a truncated buffer length.
// The native protocol is little endian. Layout is checked at compile time;
// callers must reject unsupported endianness before accepting packets.
bool little_endian_host();
ParseResult parse_frame(const std::uint8_t *bytes, std::size_t length);
} // namespace cerber_telemetry
