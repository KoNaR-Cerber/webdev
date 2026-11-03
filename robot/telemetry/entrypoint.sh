#!/usr/bin/env bash
set -e
source /opt/ros/humble/install/setup.bash
source /opt/cerber_bridge/install/setup.bash
source /opt/cerber_receiver/install/setup.bash
exec "$@"
