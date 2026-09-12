#ifndef TREE_SITTER_PYTHON_RE_COMMON_SCANNER_H_
#define TREE_SITTER_PYTHON_RE_COMMON_SCANNER_H_

#include "../scanner.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef PYTHON_RE_LANGUAGE
#error "PYTHON_RE_LANGUAGE must name the generated Tree-sitter language"
#endif

enum PythonReTokenType {
  GLOBAL_FLAGS_START,
  SCOPED_FLAGS_START,
  ENABLE_FLAGS_WITH_X,
  ENABLE_FLAGS_WITHOUT_X,
  DISABLE_FLAGS_WITH_X,
  DISABLE_FLAGS_WITHOUT_X,
  ANGLE_GROUP_NAME,
  PARENTHESIZED_GROUP_NAME,
  CONDITIONAL_GROUP_ID,
  COMMENT_GROUP_CONTENT,
  VERBOSE_WHITESPACE,
  VERBOSE_COMMENT,
  LITERAL_ESCAPE,
  HEX_ESCAPE_START,
  UNICODE_ESCAPE_SHORT_START,
  UNICODE_ESCAPE_LONG_START,
  NAMED_UNICODE_ESCAPE_START,
  UNICODE_CHARACTER_NAME,
  OUTSIDE_NUMERIC_ESCAPE_START,
  CLASS_START,
  CLASS_NUMERIC_ESCAPE_START,
  CLASS_NEGATION,
  CLASS_LEADING_CLOSE,
  CLASS_CLOSE,
  CLASS_CHARACTER,
  QUANTIFIER_STAR,
  QUANTIFIER_PLUS,
  QUANTIFIER_QUESTION,
  QUANTIFIER_LAZY_SUFFIX,
  QUANTIFIER_POSSESSIVE_SUFFIX,
  OPEN_BRACE,
  LITERAL_CHARACTER_NORMAL,
  LITERAL_CHARACTER_VERBOSE,
};

static bool python_re_is_enable_flag(int32_t character) {
  switch (character) {
  case 'a':
  case 'i':
  case 'L':
  case 'm':
  case 's':
  case 'u':
  case 'x':
    return true;
  default:
    return false;
  }
}

static bool python_re_is_disable_flag(int32_t character) {
  return character ==
    'i' ||
    character ==
    'm' ||
    character ==
    's' ||
    character == 'x';
}

static bool python_re_is_whitespace(int32_t character) {
  switch (character) {
  case ' ':
  case '\t':
  case '\n':
  case '\v':
  case '\f':
  case '\r':
    return true;
  default:
    return false;
  }
}

static bool python_re_is_metacharacter(int32_t character) {
  switch (character) {
  case '.':
  case '^':
  case '$':
  case '\\':
  case '(':
  case ')':
  case '[':
  case '*':
  case '+':
  case '?':
  case '|':
    return true;
  default:
    return false;
  }
}

static bool python_re_emit(TSLexer *lexer, uint16_t token) {
  lexer->mark_end(lexer);
  lexer->result_symbol = token;
  return true;
}

static bool
python_re_scan_character(TSLexer *lexer, int32_t character, uint16_t token) {
  if (lexer->eof(lexer) || lexer->lookahead != character) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, token);
}

static bool
python_re_scan_flags_start(TSLexer *lexer, const bool *valid_symbols) {
  if (lexer->lookahead != '(') {
    return false;
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->eof(lexer) || lexer->lookahead != '?') {
    return false;
  }
  lexer->advance(lexer, false);
  bool has_enable = false;
  while (!lexer->eof(lexer) && python_re_is_enable_flag(lexer->lookahead)) {
    has_enable = true;
    lexer->advance(lexer, false);
  }
  if (!lexer->eof(lexer) && lexer->lookahead == ')' && has_enable) {
    if (!valid_symbols[GLOBAL_FLAGS_START]) {
      return false;
    }
    lexer->result_symbol = GLOBAL_FLAGS_START;
    return true;
  }
  if (!lexer->eof(lexer) && lexer->lookahead == '-') {
    lexer->advance(lexer, false);
    bool has_disable = false;
    while (!lexer->eof(lexer) && python_re_is_disable_flag(lexer->lookahead)) {
      has_disable = true;
      lexer->advance(lexer, false);
    }
    if (!has_disable) {
      return false;
    }
  } else if (!has_enable) {
    return false;
  }
  if (
    lexer->eof(lexer) ||
    lexer->lookahead !=
    ':' ||
    !valid_symbols[SCOPED_FLAGS_START]
  ) {
    return false;
  }
  lexer->result_symbol = SCOPED_FLAGS_START;
  return true;
}

static bool python_re_scan_flag_set(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool enable
) {
  bool has_character = false;
  bool has_x = false;
  while (
    !lexer->eof(lexer) &&
    (enable ? python_re_is_enable_flag(lexer->lookahead)
            : python_re_is_disable_flag(lexer->lookahead))
  ) {
    has_character = true;
    has_x = has_x || lexer->lookahead == 'x';
    lexer->advance(lexer, false);
  }
  uint16_t token = enable
    ? (has_x ? ENABLE_FLAGS_WITH_X : ENABLE_FLAGS_WITHOUT_X)
    : (has_x ? DISABLE_FLAGS_WITH_X : DISABLE_FLAGS_WITHOUT_X);
  return has_character && valid_symbols[token] && python_re_emit(lexer, token);
}

static bool python_re_scan_payload(
  TSLexer *lexer,
  const bool *valid_symbols,
  int32_t terminator,
  uint16_t token,
  uint16_t digits_token
) {
  if (lexer->eof(lexer) || lexer->lookahead == terminator) {
    return false;
  }
  bool all_digits = true;
  do {
    all_digits = all_digits && regex_is_ascii_digit(lexer->lookahead);
    lexer->advance(lexer, false);
  } while (!lexer->eof(lexer) && lexer->lookahead != terminator);
  uint16_t result =
    all_digits && valid_symbols[digits_token] ? digits_token : token;
  return valid_symbols[result] && python_re_emit(lexer, result);
}

static bool
python_re_scan_comment(TSLexer *lexer, int32_t terminator, uint16_t token) {
  if (lexer->eof(lexer) || lexer->lookahead == terminator) {
    return false;
  }
  do {
    bool escaped = lexer->lookahead == '\\';
    lexer->advance(lexer, false);
    if (escaped && !lexer->eof(lexer)) {
      lexer->advance(lexer, false);
    }
  } while (!lexer->eof(lexer) && lexer->lookahead != terminator);
  return python_re_emit(lexer, token);
}

static bool python_re_scan_brace(TSLexer *lexer, const bool *valid_symbols) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  uint16_t token = OPEN_BRACE;
  if (!regex_scan_interval_tail(lexer, false)) {
    token = valid_symbols[LITERAL_CHARACTER_NORMAL] ? LITERAL_CHARACTER_NORMAL
                                                    : LITERAL_CHARACTER_VERBOSE;
  }
  if (!valid_symbols[token]) {
    return false;
  }
  lexer->result_symbol = token;
  return true;
}

static bool python_re_scan_escape(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool in_class
) {
  lexer->advance(lexer, false);
  if (lexer->eof(lexer)) {
    return false;
  }
  int32_t character = lexer->lookahead;
  unsigned digits = character == 'x' ? 2
    : character == 'u'               ? 4
    : character == 'U'               ? 8
                                     : 0;
  if (digits != 0) {
    uint16_t token = character == 'x' ? HEX_ESCAPE_START
      : character == 'u'              ? UNICODE_ESCAPE_SHORT_START
                                      : UNICODE_ESCAPE_LONG_START;
    if (!valid_symbols[token]) {
      return false;
    }
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (!regex_scan_hexadecimal_digits(lexer, digits, NULL))
      return false;
    lexer->result_symbol = token;
    return true;
  }
  if (character == 'N' && valid_symbols[NAMED_UNICODE_ESCAPE_START]) {
    lexer->advance(lexer, false);
    return lexer->lookahead ==
      '{' &&
      python_re_emit(lexer, NAMED_UNICODE_ESCAPE_START);
  }
  if (regex_is_ascii_digit(character)) {
    uint16_t token =
      in_class ? CLASS_NUMERIC_ESCAPE_START : OUTSIDE_NUMERIC_ESCAPE_START;
    if (
      !valid_symbols[token] || (in_class && !regex_is_octal_digit(character))
    ) {
      return false;
    }
    return python_re_emit(lexer, token);
  }
  if (regex_is_ascii_letter(character) || !valid_symbols[LITERAL_ESCAPE]) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, LITERAL_ESCAPE);
}

static bool
python_re_scan_quantifier(TSLexer *lexer, const bool *valid_symbols) {
  static const struct {
    int32_t character;
    uint16_t token;
  } tokens[] = {
    {'*', QUANTIFIER_STAR},
    {'+', QUANTIFIER_PLUS},
    {'?', QUANTIFIER_QUESTION},
    {'?', QUANTIFIER_LAZY_SUFFIX},
    {'+', QUANTIFIER_POSSESSIVE_SUFFIX},
  };
  for (
    unsigned index = 0; index < sizeof(tokens) / sizeof(tokens[0]); index += 1
  ) {
    if (
      valid_symbols[tokens[index].token] &&
      python_re_scan_character(
        lexer,
        tokens[index].character,
        tokens[index].token
      )
    ) {
      return true;
    }
  }
  return false;
}

static bool python_re_scan(TSLexer *lexer, const bool *valid_symbols) {
  if (lexer->eof(lexer)) {
    return false;
  }
  if (valid_symbols[UNICODE_CHARACTER_NAME]) {
    return python_re_scan_payload(
      lexer,
      valid_symbols,
      '}',
      UNICODE_CHARACTER_NAME,
      UNICODE_CHARACTER_NAME
    );
  }
  if (valid_symbols[ANGLE_GROUP_NAME]) {
    return python_re_scan_payload(
      lexer,
      valid_symbols,
      '>',
      ANGLE_GROUP_NAME,
      ANGLE_GROUP_NAME
    );
  }
  if (
    valid_symbols[PARENTHESIZED_GROUP_NAME] ||
    valid_symbols[CONDITIONAL_GROUP_ID]
  ) {
    return python_re_scan_payload(
      lexer,
      valid_symbols,
      ')',
      PARENTHESIZED_GROUP_NAME,
      CONDITIONAL_GROUP_ID
    );
  }
  if (valid_symbols[COMMENT_GROUP_CONTENT]) {
    return python_re_scan_comment(lexer, ')', COMMENT_GROUP_CONTENT);
  }
  if (
    valid_symbols[ENABLE_FLAGS_WITH_X] || valid_symbols[ENABLE_FLAGS_WITHOUT_X]
  ) {
    return python_re_scan_flag_set(lexer, valid_symbols, true);
  }
  if (
    valid_symbols[DISABLE_FLAGS_WITH_X] ||
    valid_symbols[DISABLE_FLAGS_WITHOUT_X]
  ) {
    return python_re_scan_flag_set(lexer, valid_symbols, false);
  }
  if (
    valid_symbols[CLASS_START] &&
    python_re_scan_character(lexer, '[', CLASS_START)
  ) {
    return true;
  }
  bool in_class = valid_symbols[CLASS_CHARACTER] ||
    valid_symbols[CLASS_CLOSE] ||
    valid_symbols[CLASS_LEADING_CLOSE] ||
    valid_symbols[CLASS_NEGATION] ||
    valid_symbols[CLASS_NUMERIC_ESCAPE_START];
  if (in_class) {
    if (
      valid_symbols[CLASS_NEGATION] &&
      python_re_scan_character(lexer, '^', CLASS_NEGATION)
    ) {
      return true;
    }
    if (
      valid_symbols[CLASS_LEADING_CLOSE] &&
      python_re_scan_character(lexer, ']', CLASS_LEADING_CLOSE)
    ) {
      return true;
    }
    if (
      valid_symbols[CLASS_CLOSE] &&
      python_re_scan_character(lexer, ']', CLASS_CLOSE)
    ) {
      return true;
    }
    if (lexer->lookahead == '\\') {
      return python_re_scan_escape(lexer, valid_symbols, true);
    }
    if (
      valid_symbols[CLASS_CHARACTER] &&
      lexer->lookahead !=
      '-' &&
      lexer->lookahead != ']'
    ) {
      lexer->advance(lexer, false);
      return python_re_emit(lexer, CLASS_CHARACTER);
    }
    return false;
  }
  if (
    (valid_symbols[GLOBAL_FLAGS_START] || valid_symbols[SCOPED_FLAGS_START]) &&
    lexer->lookahead == '('
  ) {
    return python_re_scan_flags_start(lexer, valid_symbols);
  }
  if (
    lexer->lookahead ==
    '{' &&
    (valid_symbols[OPEN_BRACE] ||
      valid_symbols[LITERAL_CHARACTER_NORMAL] ||
      valid_symbols[LITERAL_CHARACTER_VERBOSE])
  ) {
    return python_re_scan_brace(lexer, valid_symbols);
  }
  if (python_re_scan_quantifier(lexer, valid_symbols)) {
    return true;
  }
  if (valid_symbols[VERBOSE_COMMENT] && lexer->lookahead == '#') {
    return python_re_scan_comment(lexer, '\n', VERBOSE_COMMENT);
  }
  if (
    valid_symbols[VERBOSE_WHITESPACE] &&
    python_re_is_whitespace(lexer->lookahead)
  ) {
    do {
      lexer->advance(lexer, false);
    } while (!lexer->eof(lexer) && python_re_is_whitespace(lexer->lookahead));
    return python_re_emit(lexer, VERBOSE_WHITESPACE);
  }
  if (lexer->lookahead == '\\') {
    return python_re_scan_escape(lexer, valid_symbols, false);
  }
  uint16_t token = valid_symbols[LITERAL_CHARACTER_NORMAL]
    ? LITERAL_CHARACTER_NORMAL
    : LITERAL_CHARACTER_VERBOSE;
  if (
    !valid_symbols[token] ||
    python_re_is_metacharacter(lexer->lookahead) ||
    (token ==
      LITERAL_CHARACTER_VERBOSE &&
      (python_re_is_whitespace(lexer->lookahead) || lexer->lookahead == '#'))
  ) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, token);
}

#define PYTHON_RE_CONCAT_INNER(left, right) left##right
#define PYTHON_RE_CONCAT(left, right) PYTHON_RE_CONCAT_INNER(left, right)
#define PYTHON_RE_LANGUAGE_PREFIX(language) \
  PYTHON_RE_CONCAT(tree_sitter_, language)
#define PYTHON_RE_SCANNER_PREFIX(language) \
  PYTHON_RE_CONCAT(PYTHON_RE_LANGUAGE_PREFIX(language), _external_scanner)
#define PYTHON_RE_SCANNER_FUNCTION(suffix) \
  PYTHON_RE_CONCAT(PYTHON_RE_SCANNER_PREFIX(PYTHON_RE_LANGUAGE), suffix)

void *PYTHON_RE_SCANNER_FUNCTION(_create)(void) {
  return NULL;
}

void PYTHON_RE_SCANNER_FUNCTION(_destroy)(void *payload) {
  (void)payload;
}

bool PYTHON_RE_SCANNER_FUNCTION(_scan)(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;
  return python_re_scan(lexer, valid_symbols);
}

unsigned PYTHON_RE_SCANNER_FUNCTION(_serialize)(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void PYTHON_RE_SCANNER_FUNCTION(_deserialize)(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}

#undef PYTHON_RE_SCANNER_FUNCTION
#undef PYTHON_RE_SCANNER_PREFIX
#undef PYTHON_RE_LANGUAGE_PREFIX
#undef PYTHON_RE_CONCAT
#undef PYTHON_RE_CONCAT_INNER

#endif
