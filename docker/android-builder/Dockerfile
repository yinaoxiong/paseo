FROM reactnativecommunity/react-native-android:v20.1

ENV ANDROID_HOME=/opt/android
ENV ANDROID_SDK_ROOT=/opt/android
ENV PATH=${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/36.0.0:${PATH}

RUN yes | sdkmanager --licenses >/dev/null \
  && sdkmanager --install \
    "platforms;android-36" \
    "build-tools;36.0.0" \
    "build-tools;35.0.0" \
    "cmake;3.22.1" \
    "ndk;27.1.12297006" \
    "ndk;27.0.12077973" \
  && chmod -R a+rX "${ANDROID_HOME}"

ENV NPM_CONFIG_REGISTRY=https://mirrors.tencent.com/npm/
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=npmjs
