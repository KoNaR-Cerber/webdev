#include "cerber_telemetry/parser.hpp"
#include "captured_frames.hpp"
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using cerber_telemetry::ParseStatus;
using cerber_telemetry::parse_frame;
using Bytes = std::vector<std::uint8_t>;
int checks = 0;
void require(bool condition, const std::string &message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}
void u32(Bytes &b, std::size_t offset, std::uint32_t value) {
  for (std::size_t i = 0; i < 4; ++i) b.at(offset + i) = (value >> (8 * i)) & 0xff;
}
void f32(Bytes &b, std::size_t offset, float value) {
  std::uint32_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  u32(b, offset, bits);
}
void f64(Bytes &b, std::size_t offset, double value) {
  std::uint64_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  for (std::size_t i = 0; i < 8; ++i) b.at(offset + i) = (bits >> (8 * i)) & 0xff;
}
Bytes frame(std::uint32_t code, std::size_t length) {
  Bytes b(length, 0);
  u32(b, 0, code);
  u32(b, 4, static_cast<std::uint32_t>(length - 12));
  if (code == 2305) u32(b, 8, 1); // Vendor EthCommand multi-value payload.
  return b;
}
void lengths(const Bytes &b) {
  for (std::size_t length = 0; length < b.size(); ++length)
    require(parse_frame(b.data(), length).status == ParseStatus::wrong_length, "truncation accepted");
  auto long_frame = b;
  long_frame.push_back(0);
  require(parse_frame(long_frame.data(), long_frame.size()).status == ParseStatus::wrong_length,
          "oversize frame accepted");
}

int main() {
  try {
    require(cerber_telemetry::little_endian_host(), "Tests require target wire endianness");
    // Fixtures are built from independently specified byte offsets, not by
    // serializing the same C++ structs that the parser reads.
    auto robot = frame(2305, 220);
    f64(robot, 12 + 16 + 16, 90.0); // yaw: naturally aligned payload rpy[2]
    f64(robot, 12 + 88, 1.25);      // pos_world[0]
    f64(robot, 12 + 136 + 8, -0.5); // vel_body[1]
    f64(robot, 12 + 192 + 8, 0.75); // ultrasound[1]
    const auto robot_result = parse_frame(robot.data(), robot.size());
    require(robot_result.status == ParseStatus::ok, "valid robot rejected");
    const auto state = std::get<QNX2ROSProtocol::RobotState>(robot_result.payload);
    require(state.rpy[2] == 90.0 && state.pos_world[0] == 1.25 &&
            state.vel_body[1] == -0.5 && state.ultrasound[1] == 0.75, "robot offsets wrong");
    lengths(robot);
    for (const auto offset : {164U, 188U, 189U}) {
      auto bad = robot; bad[12 + offset] = 2;
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "invalid bool representation accepted");
    }
    for (const auto offset : {16U, 40U, 88U, 136U, 192U}) {
      auto bad = robot; f64(bad, 12 + offset, std::numeric_limits<double>::quiet_NaN());
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "nonfinite robot output accepted");
    }

    auto legacy = frame(2305, 212);
    f64(legacy, 12 + 8 + 16, -45.0);
    f64(legacy, 12 + 80, 2.75);
    f64(legacy, 12 + 128 + 8, -0.125);
    f64(legacy, 12 + 184 + 8, 0.625);
    const auto legacy_result = parse_frame(legacy.data(), legacy.size());
    require(legacy_result.status == ParseStatus::ok, "valid legacy robot rejected");
    const auto old_state = std::get<LegacyQNX2ROSProtocol::RobotState>(legacy_result.payload);
    require(old_state.rpy[2] == -45.0 && old_state.pos_world[0] == 2.75 &&
            old_state.vel_body[1] == -0.125 && old_state.ultrasound[1] == 0.625,
            "legacy robot offsets wrong");
    lengths(legacy);
    for (const auto offset : {156U, 180U, 181U}) {
      auto bad = legacy; bad[12 + offset] = 2;
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "legacy invalid bool accepted");
    }
    for (const auto offset : {8U, 32U, 80U, 128U, 184U}) {
      auto bad = legacy; f64(bad, 12 + offset, std::numeric_limits<double>::quiet_NaN());
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "legacy nonfinite output accepted");
    }
    auto truncated_new = robot; truncated_new.resize(212);
    require(parse_frame(truncated_new.data(), truncated_new.size()).status == ParseStatus::wrong_length,
            "truncated new format accepted as legacy");
    auto padded_old = legacy; padded_old.resize(220);
    require(parse_frame(padded_old.data(), padded_old.size()).status == ParseStatus::wrong_length,
            "padded legacy accepted as new format");
    auto wrong_type = legacy; u32(wrong_type, 8, 0);
    require(parse_frame(wrong_type.data(), wrong_type.size()).status == ParseStatus::invalid_header,
            "robot single-value header accepted");
    auto sequence = legacy; u32(sequence, 8, 0x00123401);
    require(parse_frame(sequence.data(), sequence.size()).status == ParseStatus::ok,
            "valid sequence counter rejected");

    const auto live_robot_result = parse_frame(captured_robot.data(), captured_robot.size());
    const auto live_imu_result = parse_frame(captured_imu.data(), captured_imu.size());
    require(live_robot_result.status == ParseStatus::ok && live_imu_result.status == ParseStatus::ok,
            "captured real packets rejected");
    const auto live_robot = std::get<LegacyQNX2ROSProtocol::RobotState>(live_robot_result.payload);
    const auto live_imu = std::get<QNX2ROSProtocol::ImuData>(live_imu_result.payload);
    require(live_robot.rpy[0] == live_imu.angle_roll &&
            live_robot.rpy[1] == live_imu.angle_pitch &&
            live_robot.rpy[2] == live_imu.angle_yaw &&
            live_robot.rpy_vel[0] == live_imu.angular_velocity_roll &&
            live_robot.rpy_vel[1] == live_imu.angular_velocity_pitch &&
            live_robot.rpy_vel[2] == live_imu.angular_velocity_yaw &&
            live_robot.xyz_acc[0] == live_imu.acc_x &&
            live_robot.xyz_acc[1] == live_imu.acc_y &&
            live_robot.xyz_acc[2] == live_imu.acc_z,
            "legacy offsets disagree with independently encoded dedicated IMU packet");
    require(live_robot.ultrasound[0] == 0.2800000011920929 &&
            live_robot.ultrasound[1] == 0.5789999961853027 && live_robot.battery_level == 57.0,
            "captured legacy tail offsets wrong");

    auto joints = frame(2306, 108);
    for (int i = 0; i < 12; ++i) f64(joints, 12 + 8 * i, 0.125 * (i - 6));
    const auto joint_result = parse_frame(joints.data(), joints.size());
    require(joint_result.status == ParseStatus::ok, "valid joints rejected");
    const auto joint_data = std::get<QNX2ROSProtocol::JointState>(joint_result.payload);
    require(joint_data.LF_Joint == -0.75 && joint_data.RB_Joint_2 == 0.625, "joint offsets wrong");
    lengths(joints);
    for (int i = 0; i < 12; ++i) {
      auto bad = joints; f64(bad, 12 + 8 * i, std::numeric_limits<double>::infinity());
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "nonfinite joint accepted");
    }

    auto imu = frame(0x010901, 52);
    u32(imu, 12, 1234567);
    for (int i = 0; i < 9; ++i) f32(imu, 16 + 4 * i, static_cast<float>(i) + 0.5f);
    const auto imu_result = parse_frame(imu.data(), imu.size());
    require(imu_result.status == ParseStatus::ok, "valid IMU rejected");
    const auto imu_data = std::get<QNX2ROSProtocol::ImuData>(imu_result.payload);
    require(imu_data.timestamp == 1234567 && imu_data.angle_roll == 0.5f && imu_data.acc_z == 8.5f,
            "IMU offsets wrong");
    lengths(imu);
    for (int i = 0; i < 9; ++i) {
      auto bad = imu; f32(bad, 16 + 4 * i, std::numeric_limits<float>::quiet_NaN());
      require(parse_frame(bad.data(), bad.size()).status == ParseStatus::invalid_value,
              "nonfinite IMU accepted");
    }

    auto handle = frame(2309, 60);
    f64(handle, 12, 0.25); f64(handle, 12 + 40, -0.5);
    const auto handle_result = parse_frame(handle.data(), handle.size());
    require(handle_result.status == ParseStatus::ok, "valid handle rejected");
    const auto handle_data = std::get<QNX2ROSProtocol::HandleState>(handle_result.payload);
    require(handle_data.left_axis_forward == 0.25 && handle_data.goal_vel_yaw == -0.5,
            "handle offsets wrong");
    lengths(handle);
    auto bad_handle = handle; f64(bad_handle, 12 + 40, std::numeric_limits<double>::infinity());
    require(parse_frame(bad_handle.data(), bad_handle.size()).status == ParseStatus::invalid_value,
            "nonfinite handle accepted");

    auto unknown = frame(9999, 52);
    require(parse_frame(unknown.data(), unknown.size()).status == ParseStatus::unknown_code,
            "unknown code accepted");
    auto wrong_code_length = imu; u32(wrong_code_length, 0, 2305);
    require(parse_frame(wrong_code_length.data(), wrong_code_length.size()).status == ParseStatus::wrong_length,
            "valid-size packet with wrong code accepted");
    require(parse_frame(nullptr, 52).status == ParseStatus::wrong_length, "null accepted");
    // Unaligned input must work: network buffers need not align to double.
    Bytes shifted(imu.size() + 1, 0);
    std::memcpy(shifted.data() + 1, imu.data(), imu.size());
    require(parse_frame(shifted.data() + 1, imu.size()).status == ParseStatus::ok, "unaligned input rejected");
    std::cout << "PASS: " << checks << " parser checks; no network or ROS publication\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "FAIL after " << checks << " checks: " << error.what() << '\n';
    return 1;
  }
}
