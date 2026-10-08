FROM node:24.21.0-bookworm-slim AS node-runtime
FROM reactnativecommunity/react-native-android:v20.1

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN rm -rf /usr/local/lib/node_modules/npm
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN /usr/local/bin/node --version && /usr/local/bin/npm --version

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
