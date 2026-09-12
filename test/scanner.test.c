#include <assert.h>
#include <stddef.h>
#include <string.h>

#if defined(JAVASCRIPT_REGEX_MODE)
#if JAVASCRIPT_REGEX_MODE == 0
#include "../javascript_regex/src/scanner.c"
#define SCANNER(name) tree_sitter_javascript_regex_external_scanner_##name
#define LAST_TOKEN (TOKEN_COUNT - 1)
#elif JAVASCRIPT_REGEX_MODE == 1
#include "../javascript_regex_u/src/scanner.c"
#define SCANNER(name) tree_sitter_javascript_regex_u_external_scanner_##name
#define LAST_TOKEN (TOKEN_COUNT - 1)
#else
#include "../javascript_regex_v/src/scanner.c"
#define SCANNER(name) tree_sitter_javascript_regex_v_external_scanner_##name
#define LAST_TOKEN (TOKEN_COUNT - 1)
#endif
#else
#ifndef PYTHON_RE_LANGUAGE
#define PYTHON_RE_LANGUAGE python_re_test
#endif
#include "../common/python/scanner.h"
#endif

typedef struct {
  TSLexer lexer;
  const char *source;
  size_t length;
  size_t offset;
  size_t mark;
} MockLexer;

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  MockLexer *mock = (MockLexer *)lexer;
  if (mock->offset < mock->length)
    mock->offset++;
  lexer->lookahead =
    mock->offset < mock->length ? (unsigned char)mock->source[mock->offset] : 0;
}

static void mock_mark_end(TSLexer *lexer) {
  MockLexer *mock = (MockLexer *)lexer;
  mock->mark = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const MockLexer *mock = (const MockLexer *)lexer;
  return mock->offset == mock->length;
}

static MockLexer make_lexer(const char *source, size_t length) {
  return (MockLexer){
    .lexer =
      {.lookahead = length ? (unsigned char)source[0] : 0,
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .eof = mock_eof},
    .source = source,
    .length = length,
    .mark = SIZE_MAX,
  };
}

#if defined(JAVASCRIPT_REGEX_MODE)
static void check_token(
  void *scanner,
  const char *source,
  size_t length,
  TSSymbol token,
  bool accepted,
  size_t end
) {
  MockLexer mock = make_lexer(source, length);
  bool valid[LAST_TOKEN + 1] = {false};
  valid[token] = true;
  assert(SCANNER(scan)(scanner, &mock.lexer, valid) == accepted);
  if (accepted) {
    assert(mock.lexer.result_symbol == token);
    assert((mock.mark == SIZE_MAX ? mock.offset : mock.mark) == end);
  }
}

#if JAVASCRIPT_REGEX_MODE == 0
static void check_serialization_and_reset(void) {
  Scanner *scanner = SCANNER(create)();
  assert(scanner != NULL);
  const uint32_t counts[] = {0, 1, 255, 256, 65535, 65536, UINT32_MAX};
  for (size_t index = 0; index < sizeof(counts) / sizeof(counts[0]); index++) {
    for (unsigned flags = 0; flags < 2; flags++) {
      *scanner = (Scanner){
        .capture_count = counts[index],
        .has_named_capture = flags != 0
      };
      char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE + 2];
      memset(buffer, 0x5a, sizeof(buffer));
      unsigned length = SCANNER(serialize)(scanner, buffer + 1);
      assert(length == 5);
      assert(buffer[0] == 0x5a && buffer[length + 1] == 0x5a);
      Scanner restored = {0};
      SCANNER(deserialize)(&restored, buffer + 1, length);
      assert(restored.capture_count == counts[index]);
      assert(restored.has_named_capture == scanner->has_named_capture);
    }
  }
  SCANNER(deserialize)(scanner, NULL, 0);
  assert(scanner->capture_count == 0 && !scanner->has_named_capture);
  SCANNER(destroy)(scanner);
}

static void check_capture_context_and_failed_scan(void) {
  Scanner scanner = {0};
  const char source[] = "\\1[(a)](?<x>b)(?:c)(?<=d)(e)";
  check_token(&scanner, source, sizeof(source) - 1, PATTERN_START, true, 0);
  assert(scanner.capture_count == 2 && scanner.has_named_capture);
  check_token(&scanner, "2", 1, DECIMAL_START, true, 1);
  Scanner expected = scanner;
  check_token(&scanner, "3", 1, DECIMAL_START, false, 0);
  assert(scanner.capture_count == expected.capture_count);
  assert(scanner.has_named_capture == expected.has_named_capture);
  check_token(&scanner, "", 0, PATTERN_START, true, 0);
  assert(scanner.capture_count == 0 && !scanner.has_named_capture);
}

static void check_capture_context_stops_at_the_lexer_boundary(void) {
  Scanner scanner = {0};
  const struct {
    const char *source;
    size_t length;
    uint32_t captures;
    bool named;
  } cases[] = {
    {"\\1/; /(?<outside>a)/", 2, 0, false},
    {"(?<x>a)/; /(b)/", 7, 1, true},
    {"\\1()/; /(?<outside>a)/", 4, 1, false},
    {"\\1/; /(?<outside>a)/", 2, 0, false},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    check_token(
      &scanner,
      cases[i].source,
      cases[i].length,
      PATTERN_START,
      true,
      0
    );
    assert(scanner.capture_count == cases[i].captures);
    assert(scanner.has_named_capture == cases[i].named);
  }
}
#else
static void check_stateless_lifecycle_and_unicode_tokens(void) {
  void *scanner = SCANNER(create)();
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, 0x5a, sizeof(buffer));
  assert(SCANNER(serialize)(scanner, buffer) == 0);
  assert(buffer[0] == 0x5a);
  SCANNER(deserialize)(scanner, NULL, 0);
  check_token(scanner, "0", 1, NULL_ZERO, true, 1);
  check_token(scanner, "01", 2, NULL_ZERO, false, 0);
  check_token(scanner, "x41", 3, HEX_START, true, 1);
  check_token(scanner, "x4", 2, HEX_START, false, 0);
  check_token(scanner, "uD800\\uDC00", 11, UNICODE_PAIR_START, true, 1);
  check_token(scanner, "uD800", 5, UNICODE_LEAD_START, true, 1);
  check_token(scanner, "uDC00", 5, UNICODE_TRAIL_START, true, 1);
  check_token(scanner, "u0041", 5, UNICODE_NON_SURROGATE_START, true, 1);
  check_token(scanner, "u{000010FFFF}", 13, UNICODE_CODE_POINT_START, true, 1);
  check_token(scanner, "u{110000}", 9, UNICODE_CODE_POINT_START, false, 0);
  check_token(
    scanner,
    "u{999999999999999999999}",
    24,
    UNICODE_CODE_POINT_START,
    false,
    0
  );
  check_token(scanner, "\\uDC00", 6, UNICODE_PAIR_SEPARATOR, true, 2);
#if JAVASCRIPT_REGEX_MODE == 2
  check_token(scanner, "&&x", 3, CLASS_INTERSECTION, true, 2);
  check_token(scanner, "&&&", 3, CLASS_INTERSECTION, false, 0);
  check_token(scanner, "!!", 2, CLASS_SET_RAW_CHARACTER, false, 0);
  check_token(scanner, "--x", 3, CLASS_SUBTRACTION, true, 2);
  check_token(scanner, "\0", 1, CLASS_SET_RAW_CHARACTER, true, 1);
  check_token(scanner, "", 0, CLASS_SET_RAW_CHARACTER, false, 0);
#endif
  SCANNER(destroy)(scanner);
}
#endif

#else
static void assert_token(const char *source, TSSymbol token, size_t length) {
  MockLexer mock = make_lexer(source, strlen(source));
  bool valid_symbols[LITERAL_CHARACTER_VERBOSE + 1] = {false};
  valid_symbols[token] = true;
  assert(tree_sitter_python_re_test_external_scanner_scan(
    NULL,
    &mock.lexer,
    valid_symbols
  ));
  assert(mock.lexer.result_symbol == token);
  assert(mock.mark == length);
}

static void check_stateless_lifecycle_and_serialization(void) {
  void *scanner = tree_sitter_python_re_test_external_scanner_create();
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, 0x5a, sizeof(buffer));
  assert(
    tree_sitter_python_re_test_external_scanner_serialize(scanner, buffer) == 0
  );
  for (unsigned index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == 0x5a);
  }
  tree_sitter_python_re_test_external_scanner_deserialize(scanner, NULL, 0);
  tree_sitter_python_re_test_external_scanner_deserialize(
    scanner,
    buffer,
    sizeof(buffer)
  );
  tree_sitter_python_re_test_external_scanner_destroy(scanner);
}

static void check_token_ranges_follow_the_grammar_context(void) {
  static const struct {
    const char *source;
    TSSymbol token;
    size_t length;
  } cases[] = {
    {" ", LITERAL_CHARACTER_NORMAL, 1},
    {"#", LITERAL_CHARACTER_NORMAL, 1},
    {" ", CLASS_CHARACTER, 1},
    {"#", CLASS_CHARACTER, 1},
    {"[", CLASS_START, 1},
    {"^", CLASS_NEGATION, 1},
    {"]", CLASS_LEADING_CLOSE, 1},
    {"]", CLASS_CLOSE, 1},
    {" \t\n", VERBOSE_WHITESPACE, 3},
    {"a", LITERAL_CHARACTER_VERBOSE, 1},
    {"(?ix)", GLOBAL_FLAGS_START, 1},
    {"(?i-x:", SCOPED_FLAGS_START, 1},
    {"ix", ENABLE_FLAGS_WITH_X, 2},
    {"mi", ENABLE_FLAGS_WITHOUT_X, 2},
    {"sx", DISABLE_FLAGS_WITH_X, 2},
    {"ms", DISABLE_FLAGS_WITHOUT_X, 2},
    {"name>", ANGLE_GROUP_NAME, 4},
    {"name)", PARENTHESIZED_GROUP_NAME, 4},
    {"123)", CONDITIONAL_GROUP_ID, 3},
    {"EM DASH}", UNICODE_CHARACTER_NAME, 7},
    {"\\x01", HEX_ESCAPE_START, 2},
    {"\\u0123", UNICODE_ESCAPE_SHORT_START, 2},
    {"\\U00001234", UNICODE_ESCAPE_LONG_START, 2},
    {"\\N{EM DASH}", NAMED_UNICODE_ESCAPE_START, 2},
    {"\\123", OUTSIDE_NUMERIC_ESCAPE_START, 1},
    {"\\123", CLASS_NUMERIC_ESCAPE_START, 1},
    {"\\#", LITERAL_ESCAPE, 2},
    {"{,}", OPEN_BRACE, 1},
    {"{12}", OPEN_BRACE, 1},
    {"{12,}", OPEN_BRACE, 1},
    {"{,12}", OPEN_BRACE, 1},
    {"{1,2}", OPEN_BRACE, 1},
    {"{", LITERAL_CHARACTER_NORMAL, 1},
    {"{1", LITERAL_CHARACTER_VERBOSE, 1},
    {"{ 1}", LITERAL_CHARACTER_NORMAL, 1},
    {"a\\)b)c", COMMENT_GROUP_CONTENT, 4},
    {"a\\\\)b", COMMENT_GROUP_CONTENT, 3},
    {"#a\\\nb\nc", VERBOSE_COMMENT, 5},
    {"#a\\\\\nb", VERBOSE_COMMENT, 4},
    {"#a\\\r\nb", VERBOSE_COMMENT, 4},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    assert_token(cases[index].source, cases[index].token, cases[index].length);
  }
}

static void check_invalid_tokens_are_not_emitted(void) {
  static const struct {
    const char *source;
    TSSymbol token;
  } cases[] = {
    {" ", LITERAL_CHARACTER_VERBOSE},
    {"#", LITERAL_CHARACTER_VERBOSE},
    {">", ANGLE_GROUP_NAME},
    {"}", UNICODE_CHARACTER_NAME},
    {"\\x0", HEX_ESCAPE_START},
    {"\\u123", UNICODE_ESCAPE_SHORT_START},
    {"\\U1234567", UNICODE_ESCAPE_LONG_START},
    {"\\Nname}", NAMED_UNICODE_ESCAPE_START},
    {"\\8", CLASS_NUMERIC_ESCAPE_START},
    {"\\q", LITERAL_ESCAPE},
    {"(?i)", SCOPED_FLAGS_START},
    {"(?x:", GLOBAL_FLAGS_START},
    {"{1}", LITERAL_CHARACTER_NORMAL},
  };
  for (
    unsigned index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
  ) {
    bool valid_symbols[LITERAL_CHARACTER_VERBOSE + 1] = {false};
    valid_symbols[cases[index].token] = true;
    MockLexer mock =
      make_lexer(cases[index].source, strlen(cases[index].source));
    assert(!tree_sitter_python_re_test_external_scanner_scan(
      NULL,
      &mock.lexer,
      valid_symbols
    ));
  }
  bool all_symbols[LITERAL_CHARACTER_VERBOSE + 1];
  for (
    unsigned index = 0; index < sizeof(all_symbols) / sizeof(all_symbols[0]);
    index += 1
  ) {
    all_symbols[index] = true;
  }
  MockLexer eof = make_lexer("", 0);
  assert(!tree_sitter_python_re_test_external_scanner_scan(
    NULL,
    &eof.lexer,
    all_symbols
  ));
}

#endif

int main(void) {
#if defined(JAVASCRIPT_REGEX_MODE)
#if JAVASCRIPT_REGEX_MODE == 0
  check_serialization_and_reset();
  check_capture_context_and_failed_scan();
  check_capture_context_stops_at_the_lexer_boundary();
#else
  check_stateless_lifecycle_and_unicode_tokens();
#endif
#else
  check_stateless_lifecycle_and_serialization();
  check_token_ranges_follow_the_grammar_context();
  check_invalid_tokens_are_not_emitted();
#endif
  return 0;
}
