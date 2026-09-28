cmake_minimum_required(VERSION 3.21)

project(ClairDesktop VERSION 0.3.2 LANGUAGES CXX)
include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options("$<$<CXX_COMPILER_ID:MSVC>:/utf-8>")

find_package(Qt6 6.8 REQUIRED COMPONENTS Concurrent Gui Multimedia Network Quick QuickControls2)
qt_standard_project_setup(REQUIRES 6.8)

qt_add_executable(clair-desktop
    src/main.cpp
    src/librarymodel.cpp
    src/librarymodel.h
    src/desktopsettings.cpp
    src/desktopsettings.h
    src/webserver.cpp
    src/webserver.h
    src/lyricsparser.cpp
    src/lyricsparser.h
    src/lyricsservice.cpp
    src/lyricsservice.h
    src/thememanager.cpp
    src/thememanager.h
    src/fingerprintservice.cpp
    src/fingerprintservice.h
    src/transcriptionservice.cpp
    src/transcriptionservice.h
)
target_compile_definitions(clair-desktop PRIVATE
    CLAIR_WEB_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/..")

qt_add_qml_module(clair-desktop
    URI Clair
    VERSION 1.0
    QML_FILES qml/Main.qml qml/ThemeEditor.qml
)

target_link_libraries(clair-desktop PRIVATE
    Qt6::Concurrent
    Qt6::Multimedia
    Qt6::Network
    Qt6::Quick
    Qt6::QuickControls2
)

set_target_properties(clair-desktop PROPERTIES
    WIN32_EXECUTABLE TRUE
    MACOSX_BUNDLE TRUE
)

# Native deployment for macOS/Linux (and an alternative to package-windows.ps1).
# Playback remains independent of these optional Web assets.
install(TARGETS clair-desktop BUNDLE DESTINATION . RUNTIME DESTINATION bin)
if(APPLE)
    set(CLAIR_WEB_INSTALL_DIR "clair-desktop.app/Contents/MacOS/web")
else()
    set(CLAIR_WEB_INSTALL_DIR "bin/web")
endif()
install(FILES
    "${CMAKE_CURRENT_SOURCE_DIR}/../index.html"
    "${CMAKE_CURRENT_SOURCE_DIR}/../styles.css"
    "${CMAKE_CURRENT_SOURCE_DIR}/../app.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../flac-metadata.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../library-model.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/../theme-model.js"
    DESTINATION "${CLAIR_WEB_INSTALL_DIR}")
qt_generate_deploy_qml_app_script(TARGET clair-desktop OUTPUT_SCRIPT clair_deploy_script)
install(SCRIPT "${clair_deploy_script}")

if(BUILD_TESTING)
    find_package(Qt6 6.8 REQUIRED COMPONENTS Test)
    qt_add_executable(clair-library-tests
        tests/librarymodel_test.cpp
        src/librarymodel.cpp
        src/librarymodel.h
    )
    target_link_libraries(clair-library-tests PRIVATE Qt6::Concurrent Qt6::Test)
    add_test(NAME library-model COMMAND clair-library-tests)

    qt_add_executable(clair-media-tests tests/mediaformat_test.cpp)
    target_compile_definitions(clair-media-tests PRIVATE
        CLAIR_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
    target_link_libraries(clair-media-tests PRIVATE Qt6::Multimedia Qt6::Test)
    add_test(NAME media-formats COMMAND clair-media-tests)

    qt_add_executable(clair-web-tests
        tests/webserver_test.cpp src/webserver.cpp src/webserver.h)
    target_compile_definitions(clair-web-tests PRIVATE
        CLAIR_WEB_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/..")
    target_link_libraries(clair-web-tests PRIVATE Qt6::Network Qt6::Test)
    add_test(NAME web-static-host COMMAND clair-web-tests)
    qt_add_executable(clair-lyrics-tests tests/lyricsparser_test.cpp src/lyricsparser.cpp src/lyricsparser.h)
    target_link_libraries(clair-lyrics-tests PRIVATE Qt6::Test)
    add_test(NAME lyrics-parser COMMAND clair-lyrics-tests)
    qt_add_executable(clair-lyrics-service-tests
        tests/lyricsservice_test.cpp src/lyricsservice.cpp src/lyricsservice.h
        src/lyricsparser.cpp src/lyricsparser.h)
    target_link_libraries(clair-lyrics-service-tests PRIVATE Qt6::Network Qt6::Test)
    add_test(NAME lyrics-service COMMAND clair-lyrics-service-tests)
    qt_add_executable(clair-theme-tests
        tests/thememanager_test.cpp src/thememanager.cpp src/thememanager.h)
    target_link_libraries(clair-theme-tests PRIVATE Qt6::Gui Qt6::Test)
    add_test(NAME theme-manager COMMAND clair-theme-tests)
    qt_add_executable(clair-fingerprint-tests
        tests/fingerprintservice_test.cpp src/fingerprintservice.cpp src/fingerprintservice.h)
    target_link_libraries(clair-fingerprint-tests PRIVATE Qt6::Network Qt6::Test)
    add_test(NAME fingerprint-service COMMAND clair-fingerprint-tests)
    qt_add_executable(clair-transcription-tests
        tests/transcriptionservice_test.cpp src/transcriptionservice.cpp src/transcriptionservice.h
        src/lyricsparser.cpp src/lyricsparser.h)
    target_link_libraries(clair-transcription-tests PRIVATE Qt6::Test)
    add_test(NAME transcription-service COMMAND clair-transcription-tests)
    add_test(NAME desktop-startup COMMAND clair-desktop --smoke)
    set_tests_properties(desktop-startup PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT 15)
endif()
