import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material
import QtQuick.Layouts

Item {
    id: page
    property bool hasTrack: false
    property bool playing: false
    property bool favorite: false
    property string trackTitle: ""
    property string trackArtist: ""
    property string trackAlbum: ""
    property string trackSource: ""
    property string lyricLine: ""
    property url coverSource
    property string sourceSummary: ""
    property int trackCount: 0
    property string durationText: "0:00"

    signal showLibrary()
    signal showLyrics()
    signal editTrack()
    signal openFolder()
    signal chooseFolder()
    signal showThemeEditor()
    signal toggleFavorite()

    readonly property color panel: "#201823"
    readonly property color borderTone: "#493243"
    readonly property color muted: "#bfa8b8"
    readonly property color accentTone: "#f2a3ba"

    ColumnLayout {
        anchors.fill: parent
        spacing: 12

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumWidth: 0
            Layout.minimumHeight: 0
            Layout.preferredHeight: Math.max(260, page.height - 122)
            spacing: 12

            Rectangle {
                id: recordPanel
                Layout.fillHeight: true
                Layout.minimumWidth: 0
                Layout.minimumHeight: 0
                Layout.preferredWidth: page.width * 0.43
                radius: 12
                color: "#241925"
                border.color: page.borderTone
                clip: true

                Image {
                    anchors.fill: parent
                    source: page.coverSource
                    fillMode: Image.PreserveAspectCrop
                    opacity: 0.23
                    cache: false
                }
                Rectangle {
                    anchors.fill: parent
                    color: "#9917101d"
                }
                Rectangle {
                    id: disc
                    width: Math.min(recordPanel.width - 48, recordPanel.height - 74)
                    height: width
                    anchors.centerIn: parent
                    radius: width / 2
                    color: "#151019"
                    border.color: "#65465d"
                    border.width: 2
                    Repeater {
                        model: 15
                        Rectangle {
                            width: disc.width * (0.37 + index * 0.041)
                            height: width
                            anchors.centerIn: disc
                            radius: width / 2
                            color: "transparent"
                            border.color: index % 3 === 0 ? "#654354" : "#382b39"
                            border.width: 1
                        }
                    }
                    Rectangle {
                        width: disc.width * 0.38
                        height: width
                        anchors.centerIn: parent
                        radius: width / 2
                        color: "#6a435d"
                        border.color: "#bd8ba6"
                        clip: true
                        Image {
                            anchors.fill: parent
                            source: page.coverSource
                            fillMode: Image.PreserveAspectCrop
                            cache: false
                            visible: source.toString() !== ""
                        }
                        Label {
                            anchors.centerIn: parent
                            visible: page.coverSource.toString() === ""
                            text: "C"
                            color: "#ffe2ec"
                            font.family: "Georgia"
                            font.pixelSize: Math.max(22, disc.width * 0.15)
                        }
                    }
                    Rectangle {
                        width: 12
                        height: 12
                        anchors.centerIn: parent
                        radius: 6
                        color: "#241925"
                        border.color: "#e0adbf"
                    }
                    NumberAnimation on rotation {
                        from: 0
                        to: 360
                        duration: 18000
                        loops: Animation.Infinite
                        running: page.playing
                    }
                }
                Label {
                    anchors.bottom: parent.bottom
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.bottomMargin: 16
                    text: page.playing ? "正在播放" : (page.hasTrack ? "已暂停" : "等待选择音乐")
                    color: page.muted
                    font.pixelSize: 12
                }
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumWidth: 0
                Layout.minimumHeight: 0
                radius: 12
                color: page.panel
                border.color: page.borderTone

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 22
                    spacing: 11
                    Label {
                        text: "NOW PLAYING  /  正在聆听"
                        color: page.accentTone
                        font.bold: true
                        font.letterSpacing: 2
                        font.pixelSize: 11
                    }
                    Label {
                        Layout.fillWidth: true
                        text: page.hasTrack ? page.trackTitle : "让音乐开始"
                        color: "#fff0f2"
                        font.family: "Georgia"
                        font.pixelSize: Math.max(24, Math.min(38, page.width * 0.031))
                        font.bold: true
                        elide: Text.ElideRight
                        maximumLineCount: 2
                        wrapMode: Text.Wrap
                    }
                    Label {
                        Layout.fillWidth: true
                        text: page.hasTrack ? (page.trackArtist || "未知歌手") + "  ·  " + (page.trackAlbum || "未知专辑")
                                            : "从左侧音乐库选一首歌，或先连接本地音乐目录"
                        color: page.muted
                        elide: Text.ElideRight
                    }
                    RowLayout {
                        spacing: 6
                        Button { text: page.hasTrack ? "查看歌词" : "打开音乐库"; onClicked: page.hasTrack ? page.showLyrics() : page.showLibrary() }
                        Button { text: page.favorite ? "♥ 已收藏" : "♡ 收藏"; enabled: page.hasTrack; onClicked: page.toggleFavorite() }
                        Button { text: "编辑曲目"; enabled: page.hasTrack; onClicked: page.editTrack() }
                        Button { text: "打开文件夹"; enabled: page.hasTrack; onClicked: page.openFolder() }
                    }
                    Rectangle { Layout.fillWidth: true; height: 1; color: page.borderTone }
                    Item { Layout.fillHeight: true }
                    Label { text: "当前歌词"; color: page.accentTone; font.pixelSize: 12; font.bold: true }
                    Label {
                        Layout.fillWidth: true
                        text: page.hasTrack ? (page.lyricLine || "暂无歌词 · 可导入 LRC、搜索或离线转写") : "选择歌曲后在这里显示歌词"
                        color: "#f1dfe7"
                        font.pixelSize: 19
                        wrapMode: Text.Wrap
                        maximumLineCount: 3
                        elide: Text.ElideRight
                    }
                    Item { Layout.fillHeight: true }
                    Rectangle { Layout.fillWidth: true; height: 1; color: page.borderTone }
                    RowLayout {
                        Layout.fillWidth: true
                        Label { Layout.fillWidth: true; text: "来源"; color: page.muted; font.pixelSize: 11 }
                        Label { text: "时长"; color: page.muted; font.pixelSize: 11 }
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        Label { Layout.fillWidth: true; text: page.sourceSummary; color: "#fff0f2"; elide: Text.ElideMiddle }
                        Label { text: page.durationText; color: "#fff0f2" }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 110
            Layout.minimumWidth: 0
            spacing: 12
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 10
                color: page.panel
                border.color: page.borderTone
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    Label { text: "声音信息"; color: page.accentTone; font.bold: true; font.pixelSize: 12 }
                    Label {
                        Layout.fillWidth: true
                        text: page.hasTrack ? "本地原文件播放 · " + page.trackSource.split(".").pop().toUpperCase()
                                            : "支持 MP3 / FLAC / WAV 本地播放"
                        color: "#fff0f2"
                        elide: Text.ElideRight
                    }
                    Label { text: "实时频谱未接入音频信号，因此不展示伪频谱"; color: page.muted; font.pixelSize: 11 }
                }
            }
            Rectangle {
                Layout.preferredWidth: Math.max(200, page.width * 0.28)
                Layout.fillHeight: true
                radius: 10
                color: page.panel
                border.color: page.borderTone
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    Label { text: "本地音乐库"; color: page.accentTone; font.bold: true; font.pixelSize: 12 }
                    Label { text: page.trackCount + " 首已记录曲目"; color: "#fff0f2" }
                    RowLayout {
                        Button { text: "选择文件夹"; onClicked: page.chooseFolder() }
                        Button { text: "主题"; onClicked: page.showThemeEditor() }
                    }
                }
            }
        }
    }
}
