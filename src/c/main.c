#include <pebble.h>
#include "message_keys.auto.h"
#include "resource_ids.auto.h"

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
};

enum { AUTH_OK = 0, AUTH_NEED = 1 };
enum { ERR_NONE = 0, ERR_NET = 1, ERR_AUTH = 2, ERR_TESLA = 3, ERR_CONFIG = 4 };

#define MENU_COUNT 12

static const uint8_t s_menu_cmd[MENU_COUNT] = {
  CMD_REFRESH, CMD_SIGN_IN, CMD_LOCK, CMD_UNLOCK, CMD_CLIMATE_ON, CMD_CLIMATE_OFF,
  CMD_TRUNK, CMD_FRUNK, CMD_CHARGE_OPEN, CMD_CHARGE_CLOSE, CMD_SENTRY_ON, CMD_SENTRY_OFF
};

static const char *s_menu_title[MENU_COUNT] = {
  "Refresh", "Tesla login", "Lock", "Unlock", "Climate on", "Climate off",
  "Trunk", "Frunk", "Charge open", "Charge close", "Sentry on", "Sentry off"
};

static Window *s_main_window;
static Window *s_menu_window;
static TextLayer *s_header_layer;
static BitmapLayer *s_car_bitmap_layer;
static GBitmap *s_car_bitmap;
static TextLayer *s_battery_layer;
static TextLayer *s_battery_label_layer;
static TextLayer *s_detail_layer;
static MenuLayer *s_menu_layer;

static char s_pct_buf[8];
static char s_detail_buf[96];

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

static void apply_colors(void) {
#ifdef PBL_COLOR
  window_set_background_color(s_main_window, GColorBlack);
  text_layer_set_background_color(s_header_layer, GColorClear);
  text_layer_set_text_color(s_header_layer, GColorLightGray);
  text_layer_set_background_color(s_battery_label_layer, GColorClear);
  text_layer_set_text_color(s_battery_label_layer, GColorLightGray);
  text_layer_set_background_color(s_battery_layer, GColorClear);
  text_layer_set_text_color(s_battery_layer, GColorJaegerGreen);
  text_layer_set_background_color(s_detail_layer, GColorClear);
  text_layer_set_text_color(s_detail_layer, GColorLightGray);
#else
  window_set_background_color(s_main_window, GColorBlack);
  text_layer_set_text_color(s_header_layer, GColorWhite);
  text_layer_set_text_color(s_battery_label_layer, GColorWhite);
  text_layer_set_text_color(s_battery_layer, GColorWhite);
  text_layer_set_text_color(s_detail_layer, GColorWhite);
#endif
}

static void update_status_ui(int battery_pct, int locked, int climate, int sentry, int auth_state, int err_code) {
  if (auth_state == AUTH_NEED) {
    snprintf(s_pct_buf, sizeof(s_pct_buf), "--");
    text_layer_set_text(s_battery_layer, s_pct_buf);
    text_layer_set_text(s_battery_label_layer, "Battery");
    if (err_code == ERR_CONFIG) {
      snprintf(s_detail_buf, sizeof(s_detail_buf), "Edit CONFIG\nin pkjs");
    } else {
      snprintf(s_detail_buf, sizeof(s_detail_buf), "Sign in via\nTesla login");
    }
    text_layer_set_text(s_detail_layer, s_detail_buf);
#ifdef PBL_COLOR
    text_layer_set_text_color(s_battery_layer, GColorOrange);
#endif
    layer_set_hidden(bitmap_layer_get_layer(s_car_bitmap_layer), true);
    return;
  }

  layer_set_hidden(bitmap_layer_get_layer(s_car_bitmap_layer), false);

#ifdef PBL_COLOR
  text_layer_set_text_color(s_battery_layer, GColorJaegerGreen);
#endif

  if (battery_pct >= 0 && battery_pct <= 100) {
    snprintf(s_pct_buf, sizeof(s_pct_buf), "%d%%", battery_pct);
  } else {
    snprintf(s_pct_buf, sizeof(s_pct_buf), "--");
  }
  text_layer_set_text(s_battery_layer, s_pct_buf);
  text_layer_set_text(s_battery_label_layer, "Battery");

  if (err_code != ERR_NONE && err_code != ERR_AUTH) {
    snprintf(s_detail_buf, sizeof(s_detail_buf), "Error %d\nUp = refresh", err_code);
    text_layer_set_text(s_detail_layer, s_detail_buf);
    return;
  }

  snprintf(
      s_detail_buf,
      sizeof(s_detail_buf),
      "Climate     %s\nSentry      %s\nDoors       %s",
      climate ? "On" : "Off",
      sentry ? "On" : "Off",
      locked ? "Locked" : "Unlocked");
  text_layer_set_text(s_detail_layer, s_detail_buf);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *tb = dict_find(iterator, MESSAGE_KEY_battery);
  Tuple *tl = dict_find(iterator, MESSAGE_KEY_locked);
  Tuple *tc = dict_find(iterator, MESSAGE_KEY_climate_on);
  Tuple *ts = dict_find(iterator, MESSAGE_KEY_sentry_on);
  Tuple *ta = dict_find(iterator, MESSAGE_KEY_auth_state);
  Tuple *te = dict_find(iterator, MESSAGE_KEY_err_code);

  int batt = tb ? read_tuple_int(tb) : -1;
  int locked = (int)read_tuple_int(tl);
  int climate = (int)read_tuple_int(tc);
  int sentry = (int)read_tuple_int(ts);
  int auth = (int)read_tuple_int(ta);
  int err = (int)read_tuple_int(te);

  if (!ta) {
    auth = AUTH_OK;
  }
  if (!te) {
    err = ERR_NONE;
  }

  update_status_ui(batt, locked, climate, sentry, auth, err);
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  snprintf(s_detail_buf, sizeof(s_detail_buf), "Send failed\nUp = retry");
  text_layer_set_text(s_detail_layer, s_detail_buf);
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

static void main_menu_click(ClickRecognizerRef recognizer, void *context) {
  window_stack_push(s_menu_window, true);
}

static void main_up_click(ClickRecognizerRef recognizer, void *context) {
  send_cmd_to_phone(CMD_REFRESH);
}

static void main_select_click(ClickRecognizerRef recognizer, void *context) {
  send_cmd_to_phone(CMD_REFRESH);
}

static void main_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_DOWN, main_menu_click);
  window_single_click_subscribe(BUTTON_ID_UP, main_up_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, main_select_click);
}

static void main_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  const int16_t w = b.size.w;

  window_set_background_color(window, GColorBlack);

#ifdef PBL_ROUND
  s_header_layer = text_layer_create(GRect(0, 8, w, 22));
#else
  s_header_layer = text_layer_create(GRect(0, 4, w, 22));
#endif
  text_layer_set_text(s_header_layer, "Model 3");
  text_layer_set_font(s_header_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_header_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_header_layer));

  s_car_bitmap = gbitmap_create_with_resource(RESOURCE_ID_TESLA_M3);
  GRect bg = gbitmap_get_bounds(s_car_bitmap);
  const int16_t img_x = (w - bg.size.w) / 2;
#ifdef PBL_ROUND
  const int16_t img_y = 30;
#else
  const int16_t img_y = 24;
#endif
  GRect img_frame = GRect(img_x, img_y, bg.size.w, bg.size.h);
  s_car_bitmap_layer = bitmap_layer_create(img_frame);
  bitmap_layer_set_bitmap(s_car_bitmap_layer, s_car_bitmap);
  bitmap_layer_set_compositing_mode(s_car_bitmap_layer, GCompOpSet);
  layer_add_child(root, bitmap_layer_get_layer(s_car_bitmap_layer));

#ifdef PBL_ROUND
  const int16_t batt_y = img_y + bg.size.h + 4;
#else
  const int16_t batt_y = img_y + bg.size.h + 6;
#endif
  s_battery_label_layer = text_layer_create(GRect(0, batt_y, w, 14));
  text_layer_set_text(s_battery_label_layer, "Battery");
  text_layer_set_font(s_battery_label_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_battery_label_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_battery_label_layer));

  s_battery_layer = text_layer_create(GRect(0, batt_y + 14, w, 32));
  snprintf(s_pct_buf, sizeof(s_pct_buf), "--");
  text_layer_set_text(s_battery_layer, s_pct_buf);
  text_layer_set_font(s_battery_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_battery_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_battery_layer));

  const int16_t det_y = batt_y + 14 + 32 + 4;
  int16_t det_h = b.size.h - det_y - 2;
  if (det_h < 0) {
    det_h = 0;
  }
  s_detail_layer = text_layer_create(GRect(8, det_y, w - 16, det_h));
  snprintf(s_detail_buf, sizeof(s_detail_buf), "Climate     --\nSentry      --\nDoors       --");
  text_layer_set_text(s_detail_layer, s_detail_buf);
  text_layer_set_font(s_detail_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_detail_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_detail_layer, GTextOverflowModeWordWrap);
  layer_add_child(root, text_layer_get_layer(s_detail_layer));

  apply_colors();

  window_set_click_config_provider(window, main_click_config);
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_detail_layer);
  text_layer_destroy(s_battery_layer);
  text_layer_destroy(s_battery_label_layer);
  bitmap_layer_destroy(s_car_bitmap_layer);
  gbitmap_destroy(s_car_bitmap);
  text_layer_destroy(s_header_layer);
  s_detail_layer = NULL;
  s_battery_layer = NULL;
  s_battery_label_layer = NULL;
  s_car_bitmap_layer = NULL;
  s_car_bitmap = NULL;
  s_header_layer = NULL;
}

static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  return MENU_COUNT;
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *context) {
  uint16_t i = cell_index->row;
  if (i >= MENU_COUNT) {
    return;
  }
  menu_cell_basic_draw(ctx, (Layer *)cell_layer, s_menu_title[i], NULL, NULL);
}

static void menu_select(MenuLayer *menu_layer, MenuIndex *cell_index, void *context) {
  uint16_t i = cell_index->row;
  if (i < MENU_COUNT) {
    send_cmd_to_phone(s_menu_cmd[i]);
  }
  window_stack_pop(true);
}

static uint16_t menu_get_num_sections(MenuLayer *menu_layer, void *context) {
  return 1;
}

static void menu_window_load(Window *window) {
#ifdef PBL_COLOR
  window_set_background_color(window, GColorBlack);
#endif
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks){
      .get_num_sections = menu_get_num_sections,
      .get_num_rows = menu_get_num_rows,
      .draw_row = menu_draw_row,
      .select_click = menu_select,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(root, menu_layer_get_layer(s_menu_layer));
}

static void menu_window_unload(Window *window) {
  menu_layer_destroy(s_menu_layer);
  s_menu_layer = NULL;
}

static void init(void) {
  const uint32_t inbox = 256;
  const uint32_t outbox = 128;
  app_message_open(inbox, outbox);
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_outbox_failed(outbox_failed_callback);

  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers){
      .load = main_window_load,
      .unload = main_window_unload,
  });

  s_menu_window = window_create();
  window_set_window_handlers(s_menu_window, (WindowHandlers){
      .load = menu_window_load,
      .unload = menu_window_unload,
  });

  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  window_destroy(s_menu_window);
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
