#pragma once
#include <cstdint>

// Extracted unchanged from firmware 6cb314a protocol.hpp (QNX2ROSProtocol only).
#pragma pack(push, 4)

namespace QNX2ROSProtocol{
struct ImuData{
    uint32_t timestamp;
    union{
        float buffer_float[9];
        uint8_t buffer_byte[3][12];
        struct{
            float angle_roll,angle_pitch,angle_yaw;
            float angular_velocity_roll,angular_velocity_pitch,angular_velocity_yaw;
            float acc_x,acc_y,acc_z;
        };
    };
};

struct ImuDataReceived{
    int code;                              ///< Command code
    int size;                              ///< Command value
    int cons_code;                         ///< Command type
    struct ImuData data;
};
#pragma pack(pop)

/// @brief robot state structe implementation
struct RobotState {
  int robot_basic_state;                 ///< Basic motion state of robot
  int robot_gait_state;
  int robot_policy_state;                  ///< Robot gait information
  double rpy[3];                         ///< IMU angular
  double rpy_vel[3];                     ///< IMU angular velocity
  double xyz_acc[3];                     ///< IMU acceleration
  double pos_world[3];                   ///< Position of robot in world coordinate system
  double vel_world[3];                   ///< The speed of robot in the world coordinate system
  double vel_body[3];                    ///< Speed of robot in body coordinate system
  unsigned touch_down_and_stair_trot;    ///< This function has not been activated for the time being. This data is only used to occupy the position
  bool is_charging;                      ///< Not opened temporarily
  unsigned error_state;                  ///< Not opened temporarily
  int robot_motion_state;                ///< Robot action status
  double battery_level;                  ///< Battery Percentage
  int task_state;                        ///< Not opened temporarily
  bool is_robot_need_move;               ///< When the robot is standing in place, whether it is pushed to switch into motion mode
  bool zero_position_flag;               ///< Zero return flag bit
  double ultrasound[2];
};

#pragma pack(push, 4)
struct RobotStateReceived {
  int code;                              ///< Command code
  int size;                              ///< Command value
  int cons_code;                         ///< Command type
  struct RobotState data;
};

/// @brief Jonint state structe implementation
struct JointState {
  double LF_Joint;
  double LF_Joint_1;
  double LF_Joint_2;
  double RF_Joint;
  double RF_Joint_1;
  double RF_Joint_2;
  double LB_Joint;
  double LB_Joint_1;
  double LB_Joint_2;
  double RB_Joint;
  double RB_Joint_1;
  double RB_Joint_2;
};
struct JointStateReceived {
  int code;
  int size;
  int cons_code;
  struct JointState data;
};

/// @brief handlestate state structe implementation
struct HandleState {
  double left_axis_forward;              ///< Left rocker y-axis,        range: - 1~1
  double left_axis_side;                 ///< Left rocker x-axis,         range: - 1~1
  double right_axis_yaw;                 ///< right rocker y-axis,        range: - 1~1
  double goal_vel_forward;               ///< Target linear speed in x direction
  double goal_vel_side;                  ///< Target linear speed in y direction
  double goal_vel_yaw;                   ///< Target Yaw angular velocity
};
struct HandleStateReceived {
  int code;
  int size;
  int cons_code;
  struct HandleState data;
};

}
#pragma pack(pop)
