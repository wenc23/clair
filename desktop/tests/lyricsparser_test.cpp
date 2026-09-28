#include "../src/lyricsparser.h"

#include <QtTest>

class LyricsParserTest final : public QObject {
    Q_OBJECT

private slots:
    void parsesBomMetadataAndMultipleTimestamps();
    void appliesOffsetGloballyAndSortsStably();
    void findsActiveLine();
    void ignoresMalformedTimestamps();
};

void LyricsParserTest::parsesBomMetadataAndMultipleTimestamps()
{
    const auto lines = parseLrc(QStringLiteral(
        "\ufeff[ar:Artist]\r\n[ti:Title]\r\n[00:12.34][00:15.678] Hello \r\n"
        "[01:02.003]World\n"));
    QCOMPARE(lines.size(), 3);
    QCOMPARE(lines.at(0).timeMs, 12340);
    QCOMPARE(lines.at(0).text, QStringLiteral("Hello"));
    QCOMPARE(lines.at(1).timeMs, 15678);
    QCOMPARE(lines.at(1).text, QStringLiteral("Hello"));
    QCOMPARE(lines.at(2).timeMs, 62003);
    QCOMPARE(lines.at(2).text, QStringLiteral("World"));
}

void LyricsParserTest::appliesOffsetGloballyAndSortsStably()
{
    const auto lines = parseLrc(QStringLiteral(
        "[00:02.00]second\n[offset:-1500]\n[00:01.00]first\n"
        "[00:02.00]also second\n"));
    QCOMPARE(lines.size(), 3);
    QCOMPARE(lines.at(0).timeMs, -500);
    QCOMPARE(lines.at(0).text, QStringLiteral("first"));
    QCOMPARE(lines.at(1).timeMs, 500);
    QCOMPARE(lines.at(1).text, QStringLiteral("second"));
    QCOMPARE(lines.at(2).timeMs, 500);
    QCOMPARE(lines.at(2).text, QStringLiteral("also second"));
    const auto positive = parseLrc(QStringLiteral("[offset:+250]\n[00:01.00]one"));
    QCOMPARE(positive.at(0).timeMs, 1250);
}

void LyricsParserTest::findsActiveLine()
{
    const auto lines = parseLrc(QStringLiteral(
        "[00:01.00]one\n[00:02.00]two\n[00:02.00]duplicate"));
    QCOMPARE(lineAt(lines, 999), -1);
    QCOMPARE(lineAt(lines, 1000), 0);
    QCOMPARE(lineAt(lines, 1999), 0);
    QCOMPARE(lineAt(lines, 2000), 2);
    QCOMPARE(lineAt(lines, 5000), 2);
    QCOMPARE(lineAt({}, 1000), -1);
}

void LyricsParserTest::ignoresMalformedTimestamps()
{
    const auto lines = parseLrc(QStringLiteral(
        "plain text\n[ar:Band]\n[00:61.00]bad\n[00:01.2345]bad\n"
        "[00:03.00]good"));
    QCOMPARE(lines.size(), 1);
    QCOMPARE(lines.at(0).text, QStringLiteral("good"));
}

QTEST_GUILESS_MAIN(LyricsParserTest)
#include "lyricsparser_test.moc"
