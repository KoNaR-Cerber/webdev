#pragma once
#include <cstdint>

// Exact legacy declarations from vendor Lite3_ROS commit 5c8a1f8ec5e5fdb19c7d1cfbebb274ef259a5bcb.
// See repository PROVENANCE.md and receiver/provenance/DeepRoboticsLab-LICENSE.
#pragma pack(push, 4)
namespace LegacyQNX2ROSProtocol {
struct RobotState {
  int robot_basic_state;                 ///< Basic motion state of robot
  int robot_gait_state;                  ///< Robot gait information
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
struct RobotStateReceived {
  int code;                              ///< Command code
  int size;                              ///< Command value
  int cons_code;                         ///< Command type
  struct RobotState data;
};

}
#pragma pack(pop)
