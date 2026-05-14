#include <pebble.h>
#include "message_keys.auto.h"

enum {
  CMD_REFRESH = 1,
  CMD_LOCK = 2,
  CMD_UNLOCK = 3,
  CMD_CLIMATE_ON = 4,
  CMD_CLIMATE_OFF = 5,
  CMD_TRUNK = 6,
  CMD_FRUNK = 7,
  CMD_CHARGE_OPEN = 8,
  CMD_CHARGE_CLOSE = 9,
  CMD_SENTRY_ON = 10,
  CMD_SENTRY_OFF = 11,
  CMD_SIGN_IN = 12,
  CMD_LOCATION_PHONE = 13,
};

enum { AUTH_OK = 0, AUTH_NEED = 1 };
enum { ERR_NONE = 0, ERR_NET = 1, ERR_AUTH = 2, ERR_TESLA = 3, ERR_CONFIG = 4 };

#define MENU_COUNT 13

static const uint8_t s_menu_cmd[MENU_COUNT] = {
  CMD_REFRESH, CMD_SIGN_IN, CMD_TRUNK, CMD_FRUNK, CMD_CHARGE_OPEN, CMD_CHARGE_CLOSE, CMD_CLIMATE_ON, CMD_CLIMATE_OFF,
  CMD_SENTRY_ON, CMD_SENTRY_OFF, CMD_LOCK, CMD_UNLOCK, CMD_LOCATION_PHONE
};

static const char *s_menu_title[MENU_COUNT] = {
  "Refresh", "Tesla login", "Trunk", "Frunk", "Charge open", "Charge close", "Climate on", "Climate off",
  "Sentry on", "Sentry off", "Lock", "Unlock", "Location"
};

static Window *s_main_window;
static MenuLayer *s_menu_layer;
static TextLayer *s_status_layer;
static char s_status_buf[64];

static int read_tuple_int(const Tuple *t) {
  if (!t) {
    return 0;
  }
  if (t->type == TUPLE_INT) {
    return (int)t->value->int32;
  }
  if (t->type == TUPLE_UINT) {
    return (int)t->value->uint32;
  }
  return 0;
}

static void set_status(const char *text) {
  if (text) {
    strncpy(s_status_buf, text, sizeof(s_status_buf) - 1);
    s_status_buf[sizeof(s_status_buf) - 1] = '\0';
  } else {
    s_status_buf[0] = '\0';
  }
  text_layer_set_text(s_status_layer, s_status_buf);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *tb = dict_find(iterator, MESSAGE_KEY_battery);
  Tuple *ta = dict_find(iterator, MESSAGE_KEY_auth_state);
  Tuple *te = dict_find(iterator, MESSAGE_KEY_err_code);
  Tuple *tvn = dict_find(iterator, MESSAGE_KEY_vehicle_name);

  int auth = ta ? (int)read_tuple_int(ta) : AUTH_OK;
  int err = te ? (int)read_tuple_int(te) : ERR_NONE;
  int batt = tb ? read_tuple_int(tb) : -1;

  if (auth == AUTH_NEED) {
    set_status("Sign in: Tesla login");
    menu_layer_reload_data(s_menu_layer);
    return;
  }
  if (err == ERR_CONFIG) {
    set_status("Edit CONFIG in pkjs");
    menu_layer_reload_data(s_menu_layer);
    return;
  }
  if (err != ERR_NONE && err != ERR_AUTH) {
    snprintf(s_status_buf, sizeof(s_status_buf), "Error %d", err);
    text_layer_set_text(s_status_layer, s_status_buf);
    menu_layer_reload_data(s_menu_layer);
    return;
  }

  if (tvn && tvn->type == TUPLE_CSTRING && batt >= 0 && batt <= 100) {
    snprintf(s_status_buf, sizeof(s_status_buf), "%s  %d%%", tvn->value->cstring, batt);
  } else if (tvn && tvn->type == TUPLE_CSTRING) {
    snprintf(s_status_buf, sizeof(s_status_buf), "%s", tvn->value->cstring);
  } else if (batt >= 0 && batt <= 100) {
    snprintf(s_status_buf, sizeof(s_status_buf), "%d%%", batt);
  } else {
    set_status("");
  }
  text_layer_set_text(s_status_layer, s_status_buf);
  menu_layer_reload_data(s_menu_layer);
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  (void)iterator;
  (void)reason;
  (void)context;
  set_status("Send failed");
}

static bool send_cmd_to_phone(uint8_t cmd) {
  DictionaryIterator *iter;
  AppMessageResult r = app_message_outbox_begin(&iter);
  if (r != APP_MSG_OK) {
    return false;
  }
  dict_write_uint8(iter, MESSAGE_KEY_cmd, cmd);
  r = app_message_outbox_send();
  return r == APP_MSG_OK;
}

static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  (void)menu_layer;
  (void)section_index;
  (void)context;
  return MENU_COUNT;
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *context) {
  (void)context;
  uint16_t i = cell_index->row;
  if (i >= MENU_COUNT) {
    return;
  }
  menu_cell_basic_draw(ctx, (Layer *)cell_layer, s_menu_title[i], NULL, NULL);
}

static void menu_select(MenuLayer *menu_layer, MenuIndex *cell_index, void *context) {
  (void)menu_layer;
  (void)context;
  uint16_t i = cell_index->row;
  if (i < MENU_COUNT) {
    if (!send_cmd_to_phone(s_menu_cmd[i])) {
      set_status("Queue full");
    }
  }
}

static uint16_t menu_get_num_sections(MenuLayer *menu_layer, void *context) {
  (void)menu_layer;
  (void)context;
  return 1;
}

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  const int16_t status_h = 28;

  window_set_background_color(window, GColorBlack);

  s_status_layer = text_layer_create(GRect(4, 2, b.size.w - 8, status_h));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_status_layer, GColorClear);
  text_layer_set_text_color(s_status_layer, GColorLightGray);
  text_layer_set_overflow_mode(s_status_layer, GTextOverflowModeTrailingEllipsis);
  s_status_buf[0] = '\0';
  text_layer_set_text(s_status_layer, s_status_buf);
  layer_add_child(root, text_layer_get_layer(s_status_layer));

  GRect menu_bounds = GRect(0, status_h, b.size.w, b.size.h - status_h);
  s_menu_layer = menu_layer_create(menu_bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks){
      .get_num_sections = menu_get_num_sections,
      .get_num_rows = menu_get_num_rows,
      .draw_row = menu_draw_row,
      .select_click = menu_select,
  });
  menu_layer_set_normal_colors(s_menu_layer, GColorBlack, GColorLightGray);
  menu_layer_set_highlight_colors(s_menu_layer, GColorDarkGray, GColorWhite);
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(root, menu_layer_get_layer(s_menu_layer));
}

static void main_window_unload(Window *window) {
  (void)window;
  menu_layer_destroy(s_menu_layer);
  text_layer_destroy(s_status_layer);
  s_menu_layer = NULL;
  s_status_layer = NULL;
}

static void init(void) {
  const uint32_t inbox = 512;
  const uint32_t outbox = 128;
  app_message_open(inbox, outbox);
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_outbox_failed(outbox_failed_callback);

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers){
      .load = main_window_load,
      .unload = main_window_unload,
  });

  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
