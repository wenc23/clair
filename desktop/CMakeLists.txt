cmake_minimum_required(VERSION 3.21)

project(ClairDesktop VERSION 0.1.0 LANGUAGES CXX)
include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options("$<$<CXX_COMPILER_ID:MSVC>:/utf-8>")

find_package(Qt6 6.8 REQUIRED COMPONENTS Concurrent Multimedia Quick QuickControls2)
qt_standard_project_setup(REQUIRES 6.8)

qt_add_executable(clair-desktop
    src/main.cpp
    src/librarymodel.cpp
    src/librarymodel.h
    src/desktopsettings.cpp
    src/desktopsettings.h
)

qt_add_qml_module(clair-desktop
    URI Clair
    VERSION 1.0
    QML_FILES qml/Main.qml
)

target_link_libraries(clair-desktop PRIVATE
    Qt6::Concurrent
    Qt6::Multimedia
    Qt6::Quick
    Qt6::QuickControls2
)

set_target_properties(clair-desktop PROPERTIES
    WIN32_EXECUTABLE TRUE
    MACOSX_BUNDLE TRUE
)

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
    add_test(NAME desktop-startup COMMAND clair-desktop --smoke)
    set_tests_properties(desktop-startup PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT 15)
endif()
