#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"
#include <stdint.h>
#include <stdlib.h>
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
  PROPERTY_SPACE,
  POSIX_OPEN,
  ERROR_SENTINEL,
};

enum {
  LAYOUT_MASK = 3,
  NO_CAPTURE = 4,
  BRANCH_RESET = 8,
  IN_SET = 16,
  SERIAL_HEADER = 11
};
enum Newline {
  NEWLINE_LF,
  NEWLINE_CR,
  NEWLINE_CRLF,
  NEWLINE_ANYCRLF,
  NEWLINE_ANY,
  NEWLINE_NUL
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

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}
static bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}
static bool octal(int32_t c) {
  return c >= '0' && c <= '7';
}
static bool letter(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
static bool horizontal(int32_t c) {
  return c == ' ' || c == '\t';
}
static bool contains(const char *characters, int32_t c) {
  return c > 0 && c < 128 && strchr(characters, c) != NULL;
}
static bool ascii_space(int32_t c) {
  return c == ' ' || (c >= '\t' && c <= '\r');
}
static bool whitespace(int32_t c) {
  return ascii_space(c) ||
    c ==
    0x85 ||
    c ==
    0x200e ||
    c ==
    0x200f ||
    c ==
    0x2028 ||
    c == 0x2029;
}
static int hex(int32_t c) {
  if (digit(c))
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}
static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token])
    return false;
  lexer->result_symbol = token;
  return true;
}
static bool push(Scanner *scanner, bool branch, bool capture, bool extended) {
  unsigned cost = branch ? 9 : 1;
  if (
    scanner->scope_bytes +
    cost +
    SERIAL_HEADER >
    TREE_SITTER_SERIALIZATION_BUFFER_SIZE ||
    (capture && scanner->captures == UINT32_MAX)
  )
    return false;
  Scope *scope = &scanner->scopes[scanner->depth++];
  scope->flags = scanner->flags | (branch ? BRANCH_RESET : 0);
  scope->base = scanner->captures;
  scope->maximum = scanner->captures;
  scanner->scope_bytes += cost;
  if (capture)
    scanner->captures++;
  if (extended)
    scanner->flags = (scanner->flags & NO_CAPTURE) | IN_SET | 2;
  return true;
}
static void pop(Scanner *scanner) {
  if (!scanner->depth)
    return;
  Scope *scope = &scanner->scopes[--scanner->depth];
  if (scope->flags & BRANCH_RESET) {
    if (scope->maximum > scanner->captures)
      scanner->captures = scope->maximum;
    scanner->scope_bytes -= 9;
  } else
    scanner->scope_bytes--;
  scanner->flags = scope->flags & (LAYOUT_MASK | NO_CAPTURE | IN_SET);
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
    if (!push(scanner, false, false, false))
      return false;
    return emit(lexer, valid, CONDITION_OPEN);
  }
  enum TokenType token =
    (scanner->flags & NO_CAPTURE) ? NO_CAPTURE_OPEN : CAPTURE_OPEN;
  bool capture = token == CAPTURE_OPEN;
  bool branch = false;
  bool extended = false;
  if (lexer->lookahead == '?') {
    advance(lexer);
    int32_t c = lexer->lookahead;
    token = SCOPE_OPEN;
    capture = false;
    branch = c == '|';
    extended = c == '[';
    if (c == '<') {
      advance(lexer);
      capture = lexer->lookahead !=
        '=' &&
        lexer->lookahead !=
        '!' &&
        lexer->lookahead != '*';
    } else if (c == '\'')
      capture = true;
    else if (c == 'P') {
      advance(lexer);
      capture = lexer->lookahead == '<';
      if (!capture)
        token = ITEM_OPEN;
    } else if (c == '#' || c == 'C' || c == 'R' || c == '&' || digit(c))
      token = ITEM_OPEN;
    else if (c == '+' || c == '-') {
      advance(lexer);
      if (digit(lexer->lookahead))
        token = ITEM_OPEN;
      else {
        while (letter(lexer->lookahead) || lexer->lookahead == '-')
          advance(lexer);
        if (lexer->lookahead != ':')
          token = ITEM_OPEN;
      }
    } else if (letter(c) || c == '^' || c == ')') {
      while (
        letter(lexer->lookahead) ||
        lexer->lookahead ==
        '-' ||
        lexer->lookahead == '^'
      )
        advance(lexer);
      if (lexer->lookahead != ':')
        token = ITEM_OPEN;
    }
  } else if (lexer->lookahead == '*') {
    advance(lexer);
    token = (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ? SCOPE_OPEN
                                                                 : ITEM_OPEN;
    capture = false;
  }
  if (!valid[token])
    return false;
  if (token != ITEM_OPEN && !push(scanner, branch, capture, extended))
    return false;
  return emit(lexer, valid, token);
}

static bool scan_flags(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  bool disable = valid[DISABLE_FLAGS];
  enum TokenType token = disable ? DISABLE_FLAGS : ENABLE_FLAGS;
  if (!valid[token])
    return false;
  uint8_t flags = scanner->flags;
  unsigned count = 0;
  unsigned layout = 0;
  while (contains("aimnrsxJU", lexer->lookahead) && lexer->lookahead) {
    int32_t c = lexer->lookahead;
    advance(lexer);
    count++;
    if (c == 'a' && lexer->lookahead && contains("DPSWT", lexer->lookahead))
      advance(lexer);
    if (c == 'n') {
      if (disable)
        flags &= ~NO_CAPTURE;
      else
        flags |= NO_CAPTURE;
    }
    if (c == 'x') {
      if (lexer->lookahead == 'x') {
        advance(lexer);
        layout = 2;
      } else if (!layout)
        layout = 1;
    }
  }
  if (!count)
    return false;
  if (layout) {
    if (disable)
      flags &= ~LAYOUT_MASK;
    else if (layout == 2)
      flags = (flags & NO_CAPTURE) | 2;
    else if (!(flags & LAYOUT_MASK))
      flags |= 1;
  }
  scanner->flags = flags;
  return emit(lexer, valid, token);
}

static bool is_newline(const Scanner *scanner, int32_t c) {
  switch (scanner->newline) {
  case NEWLINE_CR:
    return c == '\r';
  case NEWLINE_LF:
    return c == '\n';
  case NEWLINE_NUL:
    return c == 0;
  case NEWLINE_CRLF:
    return c == '\r';
  case NEWLINE_ANYCRLF:
    return c == '\r' || c == '\n';
  case NEWLINE_ANY:
    return c ==
      '\r' ||
      c ==
      '\n' ||
      c ==
      '\v' ||
      c ==
      '\f' ||
      c ==
      0x85 ||
      c ==
      0x2028 ||
      c == 0x2029;
  }
  return false;
}

static bool
scan_comment(const Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (!valid[VERBOSE_COMMENT])
    return false;
  advance(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    advance(lexer);
    if (is_newline(scanner, c)) {
      if (
        c ==
        '\r' &&
        scanner->newline ==
        NEWLINE_CRLF &&
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

static bool scan_quantifier(TSLexer *lexer) {
  advance(lexer);
  lexer->mark_end(lexer);
  while (horizontal(lexer->lookahead))
    advance(lexer);
  bool digits = false;
  while (digit(lexer->lookahead)) {
    digits = true;
    advance(lexer);
  }
  while (horizontal(lexer->lookahead))
    advance(lexer);
  if (lexer->lookahead == ',') {
    advance(lexer);
    while (horizontal(lexer->lookahead))
      advance(lexer);
    while (digit(lexer->lookahead)) {
      digits = true;
      advance(lexer);
    }
    while (horizontal(lexer->lookahead))
      advance(lexer);
  }
  return digits && lexer->lookahead == '}';
}

static bool scan_hex(TSLexer *lexer, bool braced) {
  if (braced) {
    if (lexer->lookahead != '{')
      return false;
    advance(lexer);
    while (horizontal(lexer->lookahead))
      advance(lexer);
  }
  uint32_t value = 0;
  bool digits = false;
  while (hex(lexer->lookahead) >= 0) {
    if (value <= 0x10ffff)
      value = value * 16 + (unsigned)hex(lexer->lookahead);
    digits = true;
    advance(lexer);
  }
  if (!digits)
    return false;
  if (braced) {
    while (horizontal(lexer->lookahead))
      advance(lexer);
    if (lexer->lookahead != '}')
      return false;
  }
  return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

static bool scan_escape(
  Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool in_class
) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->eof(lexer))
    return false;
  int32_t c = lexer->lookahead;
  if (digit(c)) {
    bool reference = !in_class && c != '0';
    if (reference && c < '8') {
      uint64_t value = 0;
      while (digit(lexer->lookahead)) {
        if (value <= UINT32_MAX)
          value = value * 10 + (unsigned)(lexer->lookahead - '0');
        advance(lexer);
      }
      reference = value < 10 || value <= scanner->captures;
    }
    if (reference)
      return emit(lexer, valid, DECIMAL_PREFIX);
    if (octal(c))
      return emit(lexer, valid, OCTAL_PREFIX);
    advance(lexer);
    lexer->mark_end(lexer);
    return emit(lexer, valid, LITERAL_ESCAPE);
  }
  advance(lexer);
  lexer->mark_end(lexer);
  if (c == 'Q' || c == 'E') {
    enum TokenType token = c == 'Q' ? QUOTE_START : QUOTE_END;
    if (!valid[token])
      return false;
    scanner->quoted = c == 'Q';
    return emit(lexer, valid, token);
  }
  if (c == 'c') {
    if (lexer->eof(lexer) || lexer->lookahead < 32 || lexer->lookahead > 126)
      return false;
    return emit(lexer, valid, CONTROL_PREFIX);
  }
  if (c == 'p' || c == 'P')
    return emit(lexer, valid, PROPERTY_PREFIX);
  if (c == 'x') {
    if (lexer->lookahead == '{') {
      if (!scan_hex(lexer, true))
        return false;
      return emit(lexer, valid, HEX_BRACE_PREFIX);
    }
    return emit(lexer, valid, HEX_SHORT_PREFIX);
  }
  if (c == 'N' && lexer->lookahead == '{') {
    advance(lexer);
    while (horizontal(lexer->lookahead))
      advance(lexer);
    if (lexer->lookahead != 'U')
      return false;
    advance(lexer);
    if (lexer->lookahead != '+')
      return false;
    advance(lexer);
    if (!scan_hex(lexer, false))
      return false;
    while (horizontal(lexer->lookahead))
      advance(lexer);
    if (lexer->lookahead != '}')
      return false;
    return emit(lexer, valid, NAMED_UNICODE_PREFIX);
  }
  if (c == 'o') {
    if (lexer->lookahead != '{')
      return false;
    advance(lexer);
    while (horizontal(lexer->lookahead))
      advance(lexer);
    if (!octal(lexer->lookahead))
      return false;
    uint32_t value = 0;
    while (octal(lexer->lookahead)) {
      if (value <= 0x10ffff)
        value = value * 8 + (unsigned)(lexer->lookahead - '0');
      advance(lexer);
    }
    while (horizontal(lexer->lookahead))
      advance(lexer);
    if (
      lexer->lookahead !=
      '}' ||
      value >
      0x10ffff ||
      (value >= 0xd800 && value <= 0xdfff)
    )
      return false;
    return emit(lexer, valid, OCTAL_BRACE_PREFIX);
  }
  if (contains("aefnrt", c) && c)
    return emit(lexer, valid, CONTROL_ESCAPE);
  if (c == 'b')
    return emit(
      lexer,
      valid,
      in_class ? BACKSPACE_ESCAPE : WORD_BOUNDARY_ESCAPE
    );
  if (c == 'B' && !in_class)
    return emit(lexer, valid, WORD_BOUNDARY_ESCAPE);
  if (contains("dDhHsSvVwW", c) && c)
    return emit(lexer, valid, CHARACTER_CLASS_ESCAPE);
  if (!in_class && contains("CNRX", c) && c)
    return emit(lexer, valid, CHARACTER_CLASS_ESCAPE);
  if (!in_class && contains("AzZG", c) && c)
    return emit(lexer, valid, ANCHOR_ESCAPE);
  if (c == 'K' && !in_class)
    return emit(lexer, valid, MATCH_RESET);
  if (!letter(c))
    return emit(lexer, valid, LITERAL_ESCAPE);
  return false;
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL] || lexer->eof(lexer))
    return false;
  bool in_class = valid[CLASS_CHARACTER] ||
    valid[FIRST_CLASS_CHARACTER] ||
    valid[CLASS_WHITESPACE];
  int32_t c = lexer->lookahead;
  if (scanner->quoted) {
    if (!valid[QUOTE_END])
      return false;
    // Quoted source is never syntax, so a token the parse state cannot accept
    // must fail that state rather than reach the generated lexer.
    lexer->result_symbol = in_class ? CLASS_CHARACTER : LITERAL_CHARACTER;
    if (c == '\\') {
      advance(lexer);
      lexer->mark_end(lexer);
      if (lexer->lookahead == 'E') {
        advance(lexer);
        lexer->mark_end(lexer);
        scanner->quoted = false;
        lexer->result_symbol = QUOTE_END;
      }
    } else
      advance(lexer);
    return true;
  }
  if (valid[COMMENT_CONTENT] || valid[VERB_ARGUMENT]) {
    if (c == ')')
      return false;
    do {
      advance(lexer);
    } while (!lexer->eof(lexer) && lexer->lookahead != ')');
    return emit(
      lexer,
      valid,
      valid[COMMENT_CONTENT] ? COMMENT_CONTENT : VERB_ARGUMENT
    );
  }
  if (valid[PROPERTY_SPACE] && ascii_space(c)) {
    do {
      advance(lexer);
    } while (ascii_space(lexer->lookahead));
    return lexer->lookahead == '^' && emit(lexer, valid, PROPERTY_SPACE);
  }
  if (valid[NEWLINE_NAME] && letter(c)) {
    char name[9] = {0};
    unsigned length = 0;
    while (letter(lexer->lookahead) && length < sizeof(name) - 1) {
      name[length++] = (char)lexer->lookahead;
      advance(lexer);
    }
    static const char *const names[] =
      {"LF", "CR", "CRLF", "ANYCRLF", "ANY", "NUL"};
    for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
      if (strcmp(name, names[i]) == 0) {
        scanner->newline = (uint8_t)i;
        return emit(lexer, valid, NEWLINE_NAME);
      }
    }
    return false;
  }
  if (c == '^' && valid[RESET_FLAGS]) {
    advance(lexer);
    scanner->flags = 0;
    return emit(lexer, valid, RESET_FLAGS);
  }
  if ((valid[ENABLE_FLAGS] || valid[DISABLE_FLAGS]) && letter(c))
    return scan_flags(scanner, lexer, valid);
  if (
    in_class &&
    (scanner->flags & LAYOUT_MASK) ==
    2 &&
    horizontal(c) &&
    valid[CLASS_WHITESPACE]
  ) {
    do {
      advance(lexer);
    } while (horizontal(lexer->lookahead));
    return emit(lexer, valid, CLASS_WHITESPACE);
  }
  if (!in_class && (scanner->flags & LAYOUT_MASK)) {
    if (whitespace(c) && valid[VERBOSE_WHITESPACE]) {
      do {
        advance(lexer);
      } while (whitespace(lexer->lookahead));
      return emit(lexer, valid, VERBOSE_WHITESPACE);
    }
    if (c == '#')
      return scan_comment(scanner, lexer, valid);
  }
  if (c == '\\')
    return scan_escape(
      scanner,
      lexer,
      valid,
      in_class || (scanner->flags & IN_SET)
    );
  if (in_class) {
    if (c == '^' && valid[CLASS_NEGATION]) {
      advance(lexer);
      return emit(lexer, valid, CLASS_NEGATION);
    }
    if ((c == ']' || c == '-') && valid[FIRST_CLASS_CHARACTER]) {
      advance(lexer);
      return emit(lexer, valid, FIRST_CLASS_CHARACTER);
    }
    if (c == ']' || c == '-')
      return false;
    advance(lexer);
    lexer->mark_end(lexer);
    return emit(
      lexer,
      valid,
      c == '[' && lexer->lookahead == ':' ? POSIX_OPEN : CLASS_CHARACTER
    );
  }
  if (
    c ==
    '(' &&
    (valid[SCOPE_OPEN] ||
      valid[CAPTURE_OPEN] ||
      valid[NO_CAPTURE_OPEN] ||
      valid[ITEM_OPEN] ||
      valid[CONDITION_OPEN])
  )
    return scan_open(scanner, lexer, valid);
  if (c == ')' && valid[SCOPE_CLOSE]) {
    if (!scanner->depth)
      return false;
    advance(lexer);
    pop(scanner);
    return emit(lexer, valid, SCOPE_CLOSE);
  }
  if (c == '|' && valid[PIPE]) {
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
  if (c == '{' && (valid[QUANTIFIER_OPEN] || valid[LITERAL_CHARACTER])) {
    if (scan_quantifier(lexer))
      return emit(lexer, valid, QUANTIFIER_OPEN);
    return emit(lexer, valid, LITERAL_CHARACTER);
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
  if (contains(".^$()[]|", c) && c) {
    if (c != ']')
      return false;
  }
  if (!valid[LITERAL_CHARACTER])
    return false;
  advance(lexer);
  return emit(lexer, valid, LITERAL_CHARACTER);
}

static void reset(Scanner *scanner) {
  memset(scanner, 0, sizeof(*scanner));
}
void *tree_sitter_pcre2_external_scanner_create(void) {
  Scanner *scanner = ts_calloc(1, sizeof(Scanner));
  if (scanner)
    reset(scanner);
  return scanner;
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
static void write_u32(char *buffer, unsigned *offset, uint32_t value) {
  for (unsigned i = 0; i < 4; i++)
    buffer[(*offset)++] = (char)(value >> (8 * i));
}
static uint32_t read_u32(const char *buffer, unsigned *offset) {
  uint32_t value = 0;
  for (unsigned i = 0; i < 4; i++)
    value |= (uint32_t)(uint8_t)buffer[(*offset)++] << (8 * i);
  return value;
}
unsigned
tree_sitter_pcre2_external_scanner_serialize(void *payload, char *buffer) {
  const Scanner *scanner = payload;
  unsigned offset = 0;
  buffer[offset++] = (char)scanner->flags;
  buffer[offset++] = (char)scanner->newline;
  buffer[offset++] = scanner->quoted;
  write_u32(buffer, &offset, scanner->captures);
  buffer[offset++] = (char)scanner->depth;
  buffer[offset++] = (char)(scanner->depth >> 8);
  buffer[offset++] = (char)scanner->scope_bytes;
  buffer[offset++] = (char)(scanner->scope_bytes >> 8);
  for (unsigned i = 0; i < scanner->depth; i++) {
    const Scope *scope = &scanner->scopes[i];
    buffer[offset++] = (char)scope->flags;
    if (scope->flags & BRANCH_RESET) {
      write_u32(buffer, &offset, scope->base);
      write_u32(buffer, &offset, scope->maximum);
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
  reset(scanner);
  if (!length)
    return;
  if (length < SERIAL_HEADER || length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE)
    return;
  unsigned offset = 0;
  scanner->flags = (uint8_t)buffer[offset++];
  scanner->newline = (uint8_t)buffer[offset++];
  scanner->quoted = buffer[offset++];
  scanner->captures = read_u32(buffer, &offset);
  scanner->depth = (uint8_t)buffer[offset++];
  scanner->depth |= (uint16_t)(uint8_t)buffer[offset++] << 8;
  scanner->scope_bytes = (uint8_t)buffer[offset++];
  scanner->scope_bytes |= (uint16_t)(uint8_t)buffer[offset++] << 8;
  if (
    scanner->depth >
    TREE_SITTER_SERIALIZATION_BUFFER_SIZE -
    SERIAL_HEADER ||
    scanner->scope_bytes +
    SERIAL_HEADER != length
  ) {
    reset(scanner);
    return;
  }
  for (unsigned i = 0; i < scanner->depth; i++) {
    if (offset >= length) {
      reset(scanner);
      return;
    }
    Scope *scope = &scanner->scopes[i];
    scope->flags = (uint8_t)buffer[offset++];
    if (scope->flags & BRANCH_RESET) {
      if (offset + 8 > length) {
        reset(scanner);
        return;
      }
      scope->base = read_u32(buffer, &offset);
      scope->maximum = read_u32(buffer, &offset);
    }
  }
  if (offset != length)
    reset(scanner);
}
