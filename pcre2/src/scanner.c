#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

enum TokenType {
  SCOPE_OPEN,
  CAPTURE_OPEN,
  NO_CAPTURE_OPEN,
  ITEM_OPEN,
  SCOPE_CLOSE,
  PIPE,
  CONDITION_OPEN,
  ENABLE_FLAGS,
  DISABLE_FLAGS,
  RESET_FLAGS,
  LITERAL_CHARACTER,
  CLASS_CHARACTER,
  FIRST_CLASS_CHARACTER,
  VERBOSE_WHITESPACE,
  CLASS_WHITESPACE,
  VERBOSE_COMMENT,
  QUOTE_START,
  QUOTE_END,
  OCTAL_PREFIX,
  DECIMAL_PREFIX,
  HEX_SHORT_PREFIX,
  HEX_BRACE_PREFIX,
  NAMED_UNICODE_PREFIX,
  CONTROL_PREFIX,
  LITERAL_ESCAPE,
  CHARACTER_CLASS_ESCAPE,
  CONTROL_ESCAPE,
  BACKSPACE_ESCAPE,
  ANCHOR_ESCAPE,
  WORD_BOUNDARY_ESCAPE,
  MATCH_RESET,
  QUANTIFIER_OPEN,
  PROPERTY_PREFIX,
  NEWLINE_NAME,
  COMMENT_CONTENT,
  VERB_ARGUMENT,
  OCTAL_BRACE_PREFIX,
  CLASS_NEGATION,
  QUANTIFIER_STAR,
  QUANTIFIER_PLUS,
  QUANTIFIER_QUESTION,
  PROPERTY_IGNORED,
  POSIX_OPEN,
  ERROR_SENTINEL,
};

enum {
  EXTENDED = 1,
  EXTENDED_MORE = 2,
  LAYOUT_MASK = 3,
  NO_CAPTURE = 4,
  BRANCH_RESET = 8,
};

enum { SERIAL_HEADER = 11, BRANCH_RESET_SCOPE_SIZE = 9 };

enum Newline {
  NEWLINE_LF,
  NEWLINE_CR,
  NEWLINE_CRLF,
  NEWLINE_ANYCRLF,
  NEWLINE_ANY,
  NEWLINE_NUL
};

static const char *const newline_names[] = {
  [NEWLINE_LF] = "LF",
  [NEWLINE_CR] = "CR",
  [NEWLINE_CRLF] = "CRLF",
  [NEWLINE_ANYCRLF] = "ANYCRLF",
  [NEWLINE_ANY] = "ANY",
  [NEWLINE_NUL] = "NUL",
};

typedef struct {
  uint8_t flags;
  uint32_t base;
  uint32_t maximum;
} Scope;

typedef struct {
  uint32_t captures;
  uint16_t depth;
  uint16_t scope_bytes;
  uint8_t flags;
  uint8_t newline;
  bool quoted;
  Scope scopes[TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SERIAL_HEADER];
} Scanner;

typedef enum {
  PLAIN_SCOPE,
  CAPTURE_SCOPE,
  BRANCH_RESET_SCOPE,
  EXTENDED_CLASS_SCOPE,
} ScopeKind;

typedef struct {
  enum TokenType token;
  ScopeKind scope;
} Opening;

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static bool is_ascii_digit(int32_t c) {
  return c >= '0' && c <= '9';
}

static bool is_octal_digit(int32_t c) {
  return c >= '0' && c <= '7';
}

static bool is_ascii_letter(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

static bool is_horizontal_space(int32_t c) {
  return c == ' ' || c == '\t';
}

static bool is_ascii_space(int32_t c) {
  return c == ' ' || (c >= '\t' && c <= '\r');
}

static bool is_layout_space(int32_t c) {
  return is_ascii_space(c) ||
    c == 0x85 ||
    c == 0x200e ||
    c == 0x200f ||
    c == 0x2028 ||
    c == 0x2029;
}

static bool is_property_ignored(int32_t c) {
  return is_ascii_space(c) || c == '-' || c == '_';
}

static bool is_one_of(const char *characters, int32_t c) {
  return c > 0 && c < 128 && strchr(characters, c) != NULL;
}

static bool is_option_letter(int32_t c) {
  return is_one_of("aimnrsxJU", c);
}

static int hexadecimal_digit_value(int32_t c) {
  if (is_ascii_digit(c)) return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool is_scalar_value(uint32_t value) {
  return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

static void skip_horizontal_space(TSLexer *lexer) {
  while (is_horizontal_space(lexer->lookahead)) advance(lexer);
}

static bool skip_ascii_digits(TSLexer *lexer) {
  bool found = false;
  while (is_ascii_digit(lexer->lookahead)) {
    found = true;
    advance(lexer);
  }
  return found;
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool push_scope(Scanner *scanner, ScopeKind kind) {
  bool branch_reset = kind == BRANCH_RESET_SCOPE;
  bool capture = kind == CAPTURE_SCOPE;
  unsigned size = branch_reset ? BRANCH_RESET_SCOPE_SIZE : 1;
  if (
    scanner->scope_bytes + size + SERIAL_HEADER >
      TREE_SITTER_SERIALIZATION_BUFFER_SIZE ||
    (capture && scanner->captures == UINT32_MAX)
  )
    return false;
  Scope *scope = &scanner->scopes[scanner->depth++];
  scope->flags = scanner->flags | (branch_reset ? BRANCH_RESET : 0);
  scope->base = scanner->captures;
  scope->maximum = scanner->captures;
  scanner->scope_bytes += size;
  if (capture) scanner->captures++;
  if (kind == EXTENDED_CLASS_SCOPE)
    scanner->flags = (scanner->flags & NO_CAPTURE) | EXTENDED_MORE;
  return true;
}

static void pop_scope(Scanner *scanner) {
  Scope *scope = &scanner->scopes[--scanner->depth];
  if (scope->flags & BRANCH_RESET) {
    if (scope->maximum > scanner->captures) scanner->captures = scope->maximum;
    scanner->scope_bytes -= BRANCH_RESET_SCOPE_SIZE;
  } else {
    scanner->scope_bytes--;
  }
  scanner->flags = scope->flags & (LAYOUT_MASK | NO_CAPTURE);
}

static Opening scan_opening(const Scanner *scanner, TSLexer *lexer) {
  if (lexer->lookahead == '*') {
    advance(lexer);
    bool alpha = lexer->lookahead >= 'a' && lexer->lookahead <= 'z';
    return (Opening){alpha ? SCOPE_OPEN : ITEM_OPEN, PLAIN_SCOPE};
  }
  if (lexer->lookahead != '?') {
    return scanner->flags & NO_CAPTURE ? (Opening){NO_CAPTURE_OPEN, PLAIN_SCOPE}
                                       : (Opening){CAPTURE_OPEN, CAPTURE_SCOPE};
  }
  advance(lexer);
  const int32_t c = lexer->lookahead;
  if (c == '|') return (Opening){SCOPE_OPEN, BRANCH_RESET_SCOPE};
  if (c == '[') return (Opening){SCOPE_OPEN, EXTENDED_CLASS_SCOPE};
  if (c == '\'') return (Opening){SCOPE_OPEN, CAPTURE_SCOPE};
  if (c == '<') {
    advance(lexer);
    bool lookbehind = is_one_of("=!*", lexer->lookahead);
    return (Opening){SCOPE_OPEN, lookbehind ? PLAIN_SCOPE : CAPTURE_SCOPE};
  }
  if (c == 'P') {
    advance(lexer);
    return lexer->lookahead == '<' ? (Opening){SCOPE_OPEN, CAPTURE_SCOPE}
                                   : (Opening){ITEM_OPEN, PLAIN_SCOPE};
  }
  if (is_ascii_digit(c) || is_one_of("#&CR", c))
    return (Opening){ITEM_OPEN, PLAIN_SCOPE};
  if (c == '+' || c == '-') {
    advance(lexer);
    if (is_ascii_digit(lexer->lookahead))
      return (Opening){ITEM_OPEN, PLAIN_SCOPE};
    while (is_ascii_letter(lexer->lookahead) || lexer->lookahead == '-')
      advance(lexer);
  } else if (is_ascii_letter(c) || c == '^' || c == ')') {
    while (
      is_ascii_letter(lexer->lookahead) ||
      lexer->lookahead == '-' ||
      lexer->lookahead == '^'
    )
      advance(lexer);
  } else {
    return (Opening){SCOPE_OPEN, PLAIN_SCOPE};
  }
  enum TokenType token = lexer->lookahead == ':' ? SCOPE_OPEN : ITEM_OPEN;
  return (Opening){token, PLAIN_SCOPE};
}

static bool scan_open(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (valid[CONDITION_OPEN]) {
    if (valid[ITEM_OPEN] && lexer->lookahead == '?') {
      advance(lexer);
      if (lexer->lookahead == 'C' || lexer->lookahead == '#')
        return emit(lexer, valid, ITEM_OPEN);
    }
    return push_scope(scanner, PLAIN_SCOPE) &&
      emit(lexer, valid, CONDITION_OPEN);
  }
  Opening opening = scan_opening(scanner, lexer);
  if (!valid[opening.token]) return false;
  return (opening.token == ITEM_OPEN || push_scope(scanner, opening.scope)) &&
    emit(lexer, valid, opening.token);
}

static bool scan_close(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (!scanner->depth) return false;
  advance(lexer);
  pop_scope(scanner);
  return emit(lexer, valid, SCOPE_CLOSE);
}

static bool scan_pipe(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  advance(lexer);
  if (scanner->depth) {
    Scope *scope = &scanner->scopes[scanner->depth - 1];
    if (scope->flags & BRANCH_RESET) {
      if (scanner->captures > scope->maximum)
        scope->maximum = scanner->captures;
      scanner->captures = scope->base;
    }
  }
  return emit(lexer, valid, PIPE);
}

static bool scan_flags(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  const bool disable = valid[DISABLE_FLAGS];
  const enum TokenType token = disable ? DISABLE_FLAGS : ENABLE_FLAGS;
  if (!valid[token] || !is_option_letter(lexer->lookahead)) return false;
  uint8_t flags = scanner->flags;
  unsigned layout = 0;
  do {
    int32_t c = lexer->lookahead;
    advance(lexer);
    if (c == 'a' && is_one_of("DPSWT", lexer->lookahead)) advance(lexer);
    if (c == 'n') {
      if (disable) flags &= ~NO_CAPTURE;
      else flags |= NO_CAPTURE;
    }
    if (c == 'x') {
      if (lexer->lookahead == 'x') {
        advance(lexer);
        layout = EXTENDED_MORE;
      } else if (!layout) {
        layout = EXTENDED;
      }
    }
  } while (is_option_letter(lexer->lookahead));
  if (layout) {
    if (disable) flags &= ~LAYOUT_MASK;
    else flags = (flags & ~LAYOUT_MASK) | layout;
  }
  scanner->flags = flags;
  return emit(lexer, valid, token);
}

static bool
scan_newline_name(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  char name[sizeof("ANYCRLF") + 1] = {0};
  unsigned length = 0;
  while (is_ascii_letter(lexer->lookahead) && length < sizeof(name) - 1) {
    name[length++] = (char)lexer->lookahead;
    advance(lexer);
  }
  const unsigned count = sizeof(newline_names) / sizeof(newline_names[0]);
  for (unsigned i = 0; i < count; i++) {
    if (strcmp(name, newline_names[i]) == 0) {
      scanner->newline = (uint8_t)i;
      return emit(lexer, valid, NEWLINE_NAME);
    }
  }
  return false;
}

static bool is_newline(const Scanner *scanner, int32_t c) {
  switch (scanner->newline) {
    case NEWLINE_LF:
      return c == '\n';
    case NEWLINE_CR:
    case NEWLINE_CRLF:
      return c == '\r';
    case NEWLINE_ANYCRLF:
      return c == '\r' || c == '\n';
    case NEWLINE_ANY:
      return c == '\r' ||
        c == '\n' ||
        c == '\v' ||
        c == '\f' ||
        c == 0x85 ||
        c == 0x2028 ||
        c == 0x2029;
    case NEWLINE_NUL:
      return c == 0;
  }
  return false;
}

static bool
scan_comment(const Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (!valid[VERBOSE_COMMENT]) return false;
  advance(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    advance(lexer);
    if (is_newline(scanner, c)) {
      if (
        c == '\r' &&
        scanner->newline == NEWLINE_CRLF &&
        lexer->lookahead != '\n'
      )
        continue;
      if (
        c == '\r' && lexer->lookahead == '\n' && scanner->newline != NEWLINE_CR
      )
        advance(lexer);
      break;
    }
  }
  return emit(lexer, valid, VERBOSE_COMMENT);
}

static bool scan_parenthesized_text(TSLexer *lexer, const bool *valid) {
  if (lexer->lookahead == ')') return false;
  do {
    advance(lexer);
  } while (!lexer->eof(lexer) && lexer->lookahead != ')');
  return emit(
    lexer,
    valid,
    valid[COMMENT_CONTENT] ? COMMENT_CONTENT : VERB_ARGUMENT
  );
}

static bool scan_property_ignored(TSLexer *lexer, const bool *valid) {
  do {
    advance(lexer);
  } while (is_property_ignored(lexer->lookahead));
  return lexer->lookahead == '^' && emit(lexer, valid, PROPERTY_IGNORED);
}

static bool scan_quantifier(TSLexer *lexer) {
  skip_horizontal_space(lexer);
  bool minimum = skip_ascii_digits(lexer);
  skip_horizontal_space(lexer);
  bool maximum = false;
  if (lexer->lookahead == ',') {
    advance(lexer);
    skip_horizontal_space(lexer);
    maximum = skip_ascii_digits(lexer);
    skip_horizontal_space(lexer);
  }
  return (minimum || maximum) && lexer->lookahead == '}';
}

static bool scan_code_point(TSLexer *lexer, unsigned radix) {
  bool found = false;
  uint32_t value = 0;
  int digit;
  while (
    (digit = hexadecimal_digit_value(lexer->lookahead)) >= 0 &&
    (unsigned)digit < radix
  ) {
    if (value <= 0x10ffff) value = value * radix + (unsigned)digit;
    found = true;
    advance(lexer);
  }
  if (!found || !is_scalar_value(value)) return false;
  skip_horizontal_space(lexer);
  return lexer->lookahead == '}';
}

static bool scan_braced_code_point(TSLexer *lexer, unsigned radix) {
  advance(lexer);
  skip_horizontal_space(lexer);
  return scan_code_point(lexer, radix);
}

static bool scan_braced_n(TSLexer *lexer, const bool *valid, bool in_class) {
  advance(lexer);
  skip_horizontal_space(lexer);
  if (lexer->lookahead != 'U')
    return !in_class &&
      scan_quantifier(lexer) &&
      emit(lexer, valid, CHARACTER_CLASS_ESCAPE);
  advance(lexer);
  if (lexer->lookahead != '+') return false;
  advance(lexer);
  return scan_code_point(lexer, 16) && emit(lexer, valid, NAMED_UNICODE_PREFIX);
}

static bool scan_backreference_number(const Scanner *scanner, TSLexer *lexer) {
  uint64_t value = 0;
  while (is_ascii_digit(lexer->lookahead)) {
    if (value <= UINT32_MAX)
      value = value * 10 + (unsigned)(lexer->lookahead - '0');
    advance(lexer);
  }
  return value < 10 || value <= scanner->captures;
}

static bool scan_digit_escape(
  const Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool in_class
) {
  const int32_t first = lexer->lookahead;
  if (
    !in_class &&
    first != '0' &&
    (first > '7' || scan_backreference_number(scanner, lexer))
  )
    return emit(lexer, valid, DECIMAL_PREFIX);
  if (is_octal_digit(first)) return emit(lexer, valid, OCTAL_PREFIX);
  advance(lexer);
  lexer->mark_end(lexer);
  return emit(lexer, valid, LITERAL_ESCAPE);
}

static bool scan_escape(
  Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool in_class
) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->eof(lexer)) return false;
  const int32_t c = lexer->lookahead;
  if (is_ascii_digit(c))
    return scan_digit_escape(scanner, lexer, valid, in_class);
  advance(lexer);
  lexer->mark_end(lexer);
  if (c == 'Q' || c == 'E') {
    const enum TokenType token = c == 'Q' ? QUOTE_START : QUOTE_END;
    if (!valid[token]) return false;
    scanner->quoted = c == 'Q';
    return emit(lexer, valid, token);
  }
  if (c == 'c')
    return lexer->lookahead >= ' ' &&
      lexer->lookahead <= '~' &&
      emit(lexer, valid, CONTROL_PREFIX);
  if (c == 'p' || c == 'P') return emit(lexer, valid, PROPERTY_PREFIX);
  if (c == 'x') {
    if (lexer->lookahead != '{') return emit(lexer, valid, HEX_SHORT_PREFIX);
    return scan_braced_code_point(lexer, 16) &&
      emit(lexer, valid, HEX_BRACE_PREFIX);
  }
  if (c == 'o')
    return lexer->lookahead == '{' &&
      scan_braced_code_point(lexer, 8) &&
      emit(lexer, valid, OCTAL_BRACE_PREFIX);
  if (c == 'N' && lexer->lookahead == '{')
    return scan_braced_n(lexer, valid, in_class);
  if (is_one_of("aefnrt", c)) return emit(lexer, valid, CONTROL_ESCAPE);
  if (c == 'b')
    return emit(
      lexer,
      valid,
      in_class ? BACKSPACE_ESCAPE : WORD_BOUNDARY_ESCAPE
    );
  if (is_one_of("dDhHsSvVwW", c))
    return emit(lexer, valid, CHARACTER_CLASS_ESCAPE);
  if (!in_class) {
    if (c == 'B') return emit(lexer, valid, WORD_BOUNDARY_ESCAPE);
    if (is_one_of("CNRX", c)) return emit(lexer, valid, CHARACTER_CLASS_ESCAPE);
    if (is_one_of("AGZz", c)) return emit(lexer, valid, ANCHOR_ESCAPE);
    if (c == 'K') return emit(lexer, valid, MATCH_RESET);
  }
  return !is_ascii_letter(c) && emit(lexer, valid, LITERAL_ESCAPE);
}

static bool scan_quoted(
  Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool in_class
) {
  if (!valid[QUOTE_END]) return false;
  // Emit even invalid tokens to prevent lexer fallback inside quoted source.
  lexer->result_symbol = in_class ? CLASS_CHARACTER : LITERAL_CHARACTER;
  if (lexer->lookahead != '\\') {
    advance(lexer);
    return true;
  }
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->lookahead == 'E') {
    advance(lexer);
    lexer->mark_end(lexer);
    scanner->quoted = false;
    lexer->result_symbol = QUOTE_END;
  }
  return true;
}

static bool scan_posix_close(TSLexer *lexer) {
  const int32_t marker = lexer->lookahead;
  if (!is_one_of(":.=", marker)) return false;
  advance(lexer);
  while (!lexer->eof(lexer) && lexer->lookahead != ']') {
    int32_t previous = lexer->lookahead;
    advance(lexer);
    if (
      previous == '\\' && (lexer->lookahead == ']' || lexer->lookahead == '\\')
    )
      advance(lexer);
    else if (previous == '[' && lexer->lookahead == marker) return false;
    else if (previous == marker && lexer->lookahead == ']') return true;
  }
  return false;
}

static bool
scan_class_token(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  const int32_t c = lexer->lookahead;
  if (
    (scanner->flags & LAYOUT_MASK) == EXTENDED_MORE &&
    is_horizontal_space(c) &&
    valid[CLASS_WHITESPACE]
  ) {
    do {
      advance(lexer);
    } while (is_horizontal_space(lexer->lookahead));
    return emit(lexer, valid, CLASS_WHITESPACE);
  }
  if (c == '^' && valid[CLASS_NEGATION]) {
    advance(lexer);
    return emit(lexer, valid, CLASS_NEGATION);
  }
  if (c == ']' || c == '-') {
    if (!valid[FIRST_CLASS_CHARACTER]) return false;
    advance(lexer);
    return emit(lexer, valid, FIRST_CLASS_CHARACTER);
  }
  advance(lexer);
  lexer->mark_end(lexer);
  return emit(
    lexer,
    valid,
    c == '[' && scan_posix_close(lexer) ? POSIX_OPEN : CLASS_CHARACTER
  );
}

static bool
scan_pattern_token(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  const int32_t c = lexer->lookahead;
  if (scanner->flags & LAYOUT_MASK) {
    if (is_layout_space(c) && valid[VERBOSE_WHITESPACE]) {
      do {
        advance(lexer);
      } while (is_layout_space(lexer->lookahead));
      return emit(lexer, valid, VERBOSE_WHITESPACE);
    }
    if (c == '#') return scan_comment(scanner, lexer, valid);
  }
  if (
    c == '(' &&
    (valid[SCOPE_OPEN] ||
      valid[CAPTURE_OPEN] ||
      valid[NO_CAPTURE_OPEN] ||
      valid[ITEM_OPEN] ||
      valid[CONDITION_OPEN])
  )
    return scan_open(scanner, lexer, valid);
  if (c == ')' && valid[SCOPE_CLOSE]) return scan_close(scanner, lexer, valid);
  if (c == '|' && valid[PIPE]) return scan_pipe(scanner, lexer, valid);
  if (c == '{' && (valid[QUANTIFIER_OPEN] || valid[LITERAL_CHARACTER])) {
    advance(lexer);
    lexer->mark_end(lexer);
    return emit(
      lexer,
      valid,
      scan_quantifier(lexer) ? QUANTIFIER_OPEN : LITERAL_CHARACTER
    );
  }
  if (c == '*' || c == '+' || c == '?') {
    advance(lexer);
    return emit(
      lexer,
      valid,
      c == '*'     ? QUANTIFIER_STAR
        : c == '+' ? QUANTIFIER_PLUS
                   : QUANTIFIER_QUESTION
    );
  }
  if (is_one_of(".^$()[|", c) || !valid[LITERAL_CHARACTER]) return false;
  advance(lexer);
  return emit(lexer, valid, LITERAL_CHARACTER);
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL] || lexer->eof(lexer)) return false;
  const bool in_class = valid[CLASS_CHARACTER] ||
    valid[FIRST_CLASS_CHARACTER] ||
    valid[CLASS_WHITESPACE];
  if (scanner->quoted) return scan_quoted(scanner, lexer, valid, in_class);
  if (valid[COMMENT_CONTENT] || valid[VERB_ARGUMENT])
    return scan_parenthesized_text(lexer, valid);
  const int32_t c = lexer->lookahead;
  if (valid[PROPERTY_IGNORED] && is_property_ignored(c))
    return scan_property_ignored(lexer, valid);
  if (valid[NEWLINE_NAME] && is_ascii_letter(c))
    return scan_newline_name(scanner, lexer, valid);
  if (c == '^' && valid[RESET_FLAGS]) {
    advance(lexer);
    scanner->flags = 0;
    return emit(lexer, valid, RESET_FLAGS);
  }
  if ((valid[ENABLE_FLAGS] || valid[DISABLE_FLAGS]) && is_ascii_letter(c))
    return scan_flags(scanner, lexer, valid);
  if (c == '\\') return scan_escape(scanner, lexer, valid, in_class);
  return in_class ? scan_class_token(scanner, lexer, valid)
                  : scan_pattern_token(scanner, lexer, valid);
}

static void
write_integer(char *buffer, unsigned *offset, uint32_t value, unsigned size) {
  for (unsigned i = 0; i < size; i++)
    buffer[(*offset)++] = (char)(value >> (8 * i));
}

static uint32_t
read_integer(const char *buffer, unsigned *offset, unsigned size) {
  uint32_t value = 0;
  for (unsigned i = 0; i < size; i++)
    value |= (uint32_t)(uint8_t)buffer[(*offset)++] << (8 * i);
  return value;
}

static bool restore(Scanner *scanner, const char *buffer, unsigned length) {
  if (length < SERIAL_HEADER || length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE)
    return false;
  unsigned offset = 0;
  scanner->flags = (uint8_t)read_integer(buffer, &offset, 1);
  scanner->newline = (uint8_t)read_integer(buffer, &offset, 1);
  scanner->quoted = read_integer(buffer, &offset, 1);
  scanner->captures = read_integer(buffer, &offset, 4);
  scanner->depth = (uint16_t)read_integer(buffer, &offset, 2);
  scanner->scope_bytes = (uint16_t)read_integer(buffer, &offset, 2);
  if (
    scanner->depth > TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SERIAL_HEADER ||
    scanner->scope_bytes + SERIAL_HEADER != length
  )
    return false;
  for (unsigned i = 0; i < scanner->depth; i++) {
    if (offset >= length) return false;
    Scope *scope = &scanner->scopes[i];
    scope->flags = (uint8_t)read_integer(buffer, &offset, 1);
    if (scope->flags & BRANCH_RESET) {
      if (offset + 8 > length) return false;
      scope->base = read_integer(buffer, &offset, 4);
      scope->maximum = read_integer(buffer, &offset, 4);
    }
  }
  return offset == length;
}

// Scopes at or above depth are unread; reset only fixed state.
static void reset(Scanner *scanner) {
  scanner->captures = 0;
  scanner->depth = 0;
  scanner->scope_bytes = 0;
  scanner->flags = 0;
  scanner->newline = NEWLINE_LF;
  scanner->quoted = false;
}

void *tree_sitter_pcre2_external_scanner_create(void) {
  return ts_calloc(1, sizeof(Scanner));
}

void tree_sitter_pcre2_external_scanner_destroy(void *payload) {
  ts_free(payload);
}

bool tree_sitter_pcre2_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  return payload && scan(payload, lexer, valid);
}

unsigned
tree_sitter_pcre2_external_scanner_serialize(void *payload, char *buffer) {
  const Scanner *scanner = payload;
  if (!scanner) return 0;
  unsigned offset = 0;
  write_integer(buffer, &offset, scanner->flags, 1);
  write_integer(buffer, &offset, scanner->newline, 1);
  write_integer(buffer, &offset, scanner->quoted, 1);
  write_integer(buffer, &offset, scanner->captures, 4);
  write_integer(buffer, &offset, scanner->depth, 2);
  write_integer(buffer, &offset, scanner->scope_bytes, 2);
  for (unsigned i = 0; i < scanner->depth; i++) {
    const Scope *scope = &scanner->scopes[i];
    write_integer(buffer, &offset, scope->flags, 1);
    if (scope->flags & BRANCH_RESET) {
      write_integer(buffer, &offset, scope->base, 4);
      write_integer(buffer, &offset, scope->maximum, 4);
    }
  }
  return offset;
}

void tree_sitter_pcre2_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  Scanner *scanner = payload;
  if (scanner && !restore(scanner, buffer, length)) reset(scanner);
}
