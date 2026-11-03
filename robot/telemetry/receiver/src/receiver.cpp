#include "cerber_telemetry/parser.hpp"

#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/pose_with_covariance_stamped.hpp>
#include <geometry_msgs/msg/quaternion.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/float64.hpp>
#include <tf2/LinearMath/Quaternion.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <stdexcept>
#include <string>

namespace {
constexpr double kDegreesToRadians = 3.14159265358979323846 / 180.0;
geometry_msgs::msg::Quaternion orientation(double roll, double pitch, double yaw) {
  tf2::Quaternion q;
  q.setRPY(roll * kDegreesToRadians, pitch * kDegreesToRadians, yaw * kDegreesToRadians);
  geometry_msgs::msg::Quaternion result;
  result.x = q.x(); result.y = q.y(); result.z = q.z(); result.w = q.w();
  return result;
}

class Receiver final : public rclcpp::Node {
public:
  Receiver() : Node("cerber_telemetry_receiver") {
    if (!cerber_telemetry::little_endian_host())
      throw std::runtime_error("Wire protocol requires a little-endian host");
    const auto bind_address = declare_parameter<std::string>("bind_address", "");
    const auto robot_address = declare_parameter<std::string>("robot_address", "");
    const auto port = declare_parameter<int>("local_port", 43897);
    sockaddr_in local{};
    local.sin_family = AF_INET;
    if (port < 1 || port > 65535 ||
        inet_pton(AF_INET, bind_address.c_str(), &local.sin_addr) != 1 ||
        inet_pton(AF_INET, robot_address.c_str(), &robot_address_) != 1)
      throw std::runtime_error("Invalid UDP address or port parameter");
    if (local.sin_addr.s_addr == htonl(INADDR_ANY) ||
        robot_address_.s_addr == htonl(INADDR_ANY))
      throw std::runtime_error("Explicit bind and robot addresses are required");
    local.sin_port = htons(static_cast<std::uint16_t>(port));

    odom_pose_ = create_publisher<geometry_msgs::msg::PoseWithCovarianceStamped>("/leg_odom", 10);
    odom_ = create_publisher<nav_msgs::msg::Odometry>("/leg_odom2", 10);
    joints_ = create_publisher<sensor_msgs::msg::JointState>("/joint_states", 10);
    imu_ = create_publisher<sensor_msgs::msg::Imu>("/imu/data", 10);
    ultrasound_ = create_publisher<std_msgs::msg::Float64>("/us_publisher/ultrasound_distance", 10);

    // No SO_REUSEADDR: another receiver must not silently share this port.
    socket_ = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (socket_ < 0) throw std::runtime_error(std::string("socket: ") + std::strerror(errno));
    if (bind(socket_, reinterpret_cast<sockaddr *>(&local), sizeof(local)) != 0) {
      const std::string error = std::strerror(errno);
      close(socket_); socket_ = -1;
      throw std::runtime_error("bind: " + error);
    }
    try {
      // A bounded nonblocking callback eliminates the original receiver's
      // blocking-thread shutdown hang and shared stop-flag race.
      timer_ = create_wall_timer(std::chrono::milliseconds(2), [this]() { receive(); });
      stats_timer_ = create_wall_timer(std::chrono::seconds(10), [this]() {
        RCLCPP_INFO(get_logger(),
          "packets robot=%llu imu=%llu joints=%llu ignored_handle=%llu rejected=%llu foreign=%llu",
          counts_[0], counts_[1], counts_[2], counts_[3], rejected_, foreign_);
      });
    } catch (...) {
      close(socket_); socket_ = -1; throw;
    }
    RCLCPP_INFO(get_logger(), "Receive-only UDP %s:%d; source %s; no command subscriptions",
                bind_address.c_str(), static_cast<int>(port), robot_address.c_str());
  }

  ~Receiver() override {
    if (timer_) timer_->cancel();
    if (stats_timer_) stats_timer_->cancel();
    if (socket_ >= 0) close(socket_);
  }

private:
  void receive() {
    for (int i = 0; i < 64 && rclcpp::ok(); ++i) {
      std::array<std::uint8_t, 512> bytes{};
      sockaddr_in source{};
      socklen_t source_length = sizeof(source);
      // Linux MSG_TRUNC returns the ORIGINAL datagram length. An oversized
      // datagram cannot masquerade as one of the supported fixed-size frames.
      const auto length = recvfrom(socket_, bytes.data(), bytes.size(), MSG_DONTWAIT | MSG_TRUNC,
                                   reinterpret_cast<sockaddr *>(&source), &source_length);
      if (length < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) return;
        if (errno == EINTR) continue;
        throw std::runtime_error(std::string("recvfrom: ") + std::strerror(errno));
      }
      if (source_length < sizeof(sockaddr_in) || source.sin_family != AF_INET ||
          source.sin_addr.s_addr != robot_address_.s_addr) { ++foreign_; continue; }
      if (static_cast<std::size_t>(length) > bytes.size()) { ++rejected_; continue; }
      const auto parsed = cerber_telemetry::parse_frame(bytes.data(), static_cast<std::size_t>(length));
      if (parsed.status != cerber_telemetry::ParseStatus::ok) { ++rejected_; continue; }
      switch (parsed.code) {
      case 2305:
        if (const auto *legacy = std::get_if<LegacyQNX2ROSProtocol::RobotState>(&parsed.payload))
          publish_robot(*legacy);
        else
          publish_robot(std::get<QNX2ROSProtocol::RobotState>(parsed.payload));
        ++counts_[0]; break;
      case 0x010901:
        publish(std::get<QNX2ROSProtocol::ImuData>(parsed.payload)); ++counts_[1]; break;
      case 2306:
        publish(std::get<QNX2ROSProtocol::JointState>(parsed.payload)); ++counts_[2]; break;
      case 2309: ++counts_[3]; break; // Controller inputs are not needed by the telemetry API.
      }
    }
  }

  template <typename T>
  void publish_robot(const T &v) {
    const auto stamp = now();
    geometry_msgs::msg::PoseWithCovarianceStamped pose;
    pose.header.stamp = stamp;
    pose.header.frame_id = "odom";
    pose.pose.pose.orientation = orientation(0, 0, v.rpy[2]);
    pose.pose.pose.position.x = v.pos_world[0];
    pose.pose.pose.position.y = v.pos_world[1];
    pose.pose.pose.position.z = v.pos_world[2];
    odom_pose_->publish(pose);

    nav_msgs::msg::Odometry odom;
    odom.header = pose.header;
    odom.child_frame_id = "base_link";
    odom.pose = pose.pose;
    odom.twist.twist.linear.x = v.vel_body[0];
    odom.twist.twist.linear.y = v.vel_body[1];
    odom.twist.twist.angular.z = v.rpy_vel[2];
    odom_->publish(odom);

    std_msgs::msg::Float64 ultrasound;
    ultrasound.data = v.ultrasound[1];
    ultrasound_->publish(ultrasound);
  }

  void publish(const QNX2ROSProtocol::ImuData &v) {
    sensor_msgs::msg::Imu msg;
    msg.header.stamp = now();
    msg.header.frame_id = "base_link";
    msg.orientation = orientation(v.angle_roll, v.angle_pitch, v.angle_yaw);
    msg.angular_velocity.x = v.angular_velocity_roll;
    msg.angular_velocity.y = v.angular_velocity_pitch;
    msg.angular_velocity.z = v.angular_velocity_yaw;
    msg.linear_acceleration.x = v.acc_x;
    msg.linear_acceleration.y = v.acc_y;
    msg.linear_acceleration.z = v.acc_z;
    imu_->publish(msg);
  }

  void publish(const QNX2ROSProtocol::JointState &v) {
    sensor_msgs::msg::JointState msg;
    msg.header.stamp = now();
    msg.name = {"LF_Joint", "LF_Joint_1", "LF_Joint_2", "RF_Joint", "RF_Joint_1", "RF_Joint_2",
                "LB_Joint", "LB_Joint_1", "LB_Joint_2", "RB_Joint", "RB_Joint_1", "RB_Joint_2"};
    msg.position = {-v.LF_Joint, -v.LF_Joint_1, -v.LF_Joint_2,
                    -v.RF_Joint, -v.RF_Joint_1, -v.RF_Joint_2,
                    -v.LB_Joint, -v.LB_Joint_1, -v.LB_Joint_2,
                    -v.RB_Joint, -v.RB_Joint_1, -v.RB_Joint_2};
    joints_->publish(msg);
  }

  int socket_ = -1;
  in_addr robot_address_{};
  unsigned long long counts_[4]{};
  unsigned long long rejected_ = 0, foreign_ = 0;
  rclcpp::Publisher<geometry_msgs::msg::PoseWithCovarianceStamped>::SharedPtr odom_pose_;
  rclcpp::Publisher<nav_msgs::msg::Odometry>::SharedPtr odom_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr joints_;
  rclcpp::Publisher<sensor_msgs::msg::Imu>::SharedPtr imu_;
  rclcpp::Publisher<std_msgs::msg::Float64>::SharedPtr ultrasound_;
  rclcpp::TimerBase::SharedPtr timer_, stats_timer_;
};
} // namespace

int main(int argc, char **argv) {
  rclcpp::init(argc, argv);
  int result = 0;
  try {
    rclcpp::spin(std::make_shared<Receiver>());
  } catch (const std::exception &error) {
    RCLCPP_FATAL(rclcpp::get_logger("cerber_telemetry_receiver"), "%s", error.what());
    result = 1;
  }
  rclcpp::shutdown();
  return result;
}
