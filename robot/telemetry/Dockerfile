ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Use Ubuntu dependencies only. ROS itself remains the existing source-built
# underlay; never install ros-humble-* into its /opt/ros/humble tree.
RUN apt-get -o Dir::Etc::sourcelist=/etc/apt/sources.list \
            -o Dir::Etc::sourceparts=- update \
 && DEBIAN_FRONTEND=noninteractive apt-get \
            -o Dir::Etc::sourcelist=/etc/apt/sources.list \
            -o Dir::Etc::sourceparts=- install -y --no-install-recommends \
            python3-tornado python3-bson python3-cbor2 python3-ujson \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cerber_bridge
COPY rosbridge_suite-54868a228d8c05cc60cb85d6e4813a3271283e31.tar.gz SOURCE.sha256 ./
RUN sha256sum -c SOURCE.sha256 \
 && mkdir -p src \
 && tar -xzf rosbridge_suite-54868a228d8c05cc60cb85d6e4813a3271283e31.tar.gz -C src \
 && source /opt/ros/humble/install/setup.bash \
 && MAKEFLAGS=-j2 colcon build --merge-install --executor sequential \
      --packages-select rosbridge_test_msgs rosapi_msgs rosapi rosbridge_msgs rosbridge_library rosbridge_server \
      --cmake-args -DBUILD_TESTING=OFF -DCMAKE_BUILD_TYPE=Release \
 && dpkg-query -W python3-tornado python3-bson python3-cbor2 python3-ujson \
      > /opt/cerber_bridge/ubuntu-dependency-versions.txt

COPY telemetry_bridge.py entrypoint.sh ./
RUN chmod 0755 /opt/cerber_bridge/entrypoint.sh \
 && source /opt/ros/humble/install/setup.bash \
 && source /opt/cerber_bridge/install/setup.bash \
 && python3 /opt/cerber_bridge/telemetry_bridge.py --self-test

WORKDIR /opt/cerber_receiver
COPY receiver/ src/cerber_telemetry/
RUN source /opt/ros/humble/install/setup.bash \
 && MAKEFLAGS=-j2 colcon build --merge-install --executor sequential \
      --cmake-args -DBUILD_TESTING=ON -DCMAKE_BUILD_TYPE=RelWithDebInfo \
 && cd build/cerber_telemetry && ctest --output-on-failure

ENV ROS_LOCALHOST_ONLY=1
ENTRYPOINT ["/opt/cerber_bridge/entrypoint.sh"]
CMD ["python3", "/opt/cerber_bridge/telemetry_bridge.py"]
