import {
  SET_EVENTS,
  USER,
  INITIALIZE_CHAT,
  SHOW_MY_PUBLIC_CALENDAR,
  SHOW_ALL_CALENDARS,
  SET_PUBLIC_CALENDAR_EVENTS,
  SHOW_INSTRUCTIONS
} from "../ActionTypes";

import queryString from "query-string";
import { AUTH_CONNECTED, AUTH_DISCONNECTED } from "../ActionTypes";
import { defaultEvents } from "../../io/eventDefaults";
import { showSettingsAddCalendar } from "./calendarActionLazy";

import {
  saveEvents,
  publishEvents,
  handleIntentsInQueryString,
  fetchContactData,
  updatePublicEvent,
  removePublicEvent,
  loadPublicCalendar,
  savePreferences,
  fetchPreferences,
  fetchIcsUrl,
  importCalendarEvents
} from "../../io/event";
import { initializeContactData } from "./contactActionLazy";
import { initializeCalendars } from "./calendarActionLazy";

import { createSessionChat } from "../../io/chat";

import { uuid } from "../../io/eventFN";
import { setCurrentEvent } from "./eventAction";
import {
  isUserSignedIn,
  isSignInPending,
  handlePendingSignIn,
  loadUserData
} from "blockstack";

// #########################
// Chat
// #########################

function asAction_initializeChat(chat) {
  return { type: INITIALIZE_CHAT, payload: chat };
}

export function initializeChat() {
  return async (dispatch, getState) => {
    let chat = createSessionChat();
    dispatch(asAction_initializeChat(chat));
  };
}

// ################
// LOAD USER DATA
// ################

function asAction_authenticated(userData) {
  return { type: AUTH_CONNECTED, user: userData };
}

function asAction_disconnected() {
  return { type: AUTH_DISCONNECTED };
}

function asAction_user(userData) {
  return { type: USER, user: userData };
}

function asAction_setEvents(allEvents) {
  return { type: SET_EVENTS, allEvents };
}

function initializeQueryString(query, username) {
  function eventFromIntent(username) {
    return (title, start, end, via) => {
      const eventInfo = {};
      eventInfo.title = title || "New Event";
      eventInfo.start = start != null ? new Date(start) : new Date();
      eventInfo.end = end != null ? new Date(end) : null;
      eventInfo.owner = via != null ? via : username;
      return eventInfo;
    };
  }
  return (dispatch, getState) => {
    handleIntentsInQueryString(
      query,
      eventFromIntent(username),
      eventInfo => {
        dispatch(setCurrentEvent(eventInfo, username ? "add" : "view"));
      },
      eventInfo => dispatch(setCurrentEvent(eventInfo, "add")),
      url => dispatch(showSettingsAddCalendar(url)),
      name => dispatch(viewPublicCalendar(name))
    );
  };
}

export function initializeEvents() {
  return (dispatch, getState) => {
    dispatch(initializeCalendars())
      .then(calendars => loadCalendarEvents(calendars))
      .then(allEvents => {
        dispatch(asAction_setEvents(allEvents));
      });
  };
}

export function initializeLazyActions() {
  const query = window.location.search;
  return async (dispatch, getState) => {
    if (isUserSignedIn()) {
      console.log("is signed in");
      const userData = loadUserData();
      dispatch(asAction_authenticated(userData));
      dispatch(asAction_user(userData));
      dispatch(initializeQueryString(query, userData.username));
      dispatch(initializePreferences());
      dispatch(initializeEvents());
      dispatch(initializeContactData());
    } else if (isSignInPending()) {
      console.log("handling pending sign in");
      handlePendingSignIn().then(userData => {
        window.location.search = removeAuthResponse(window.location.search);
        dispatch(asAction_authenticated(userData));
      });
    } else {
      dispatch(asAction_disconnected());
      dispatch(initializeQueryString(query, null));
    }
  };
}

function removeAuthResponse(search) {
  const parsed = queryString.parse(search);
  if (parsed.authResponse) {
    delete parsed.authResponse;
    return queryString.stringify(parsed);
  } else {
    return search;
  }
}

function asAction_setPublicCalendarEvents(allEvents, calendar) {
  return { type: SET_PUBLIC_CALENDAR_EVENTS, payload: { allEvents, calendar } };
}

function viewPublicCalendar(name) {
  return async (dispatch, getState) => {
    console.log("viewpubliccalendar", name);
    if (name) {
      const parts = name.split("@");
      if (parts.length === 2) {
        const calendarName = parts[0];
        const username = parts[1];
        loadPublicCalendar(calendarName, username).then(
          ({ allEvents, calendar }) => {
            dispatch(asAction_setPublicCalendarEvents(allEvents, calendar));
          },
          error => {
            console.log("failed to load public calendar " + name, error);
          }
        );
      }
    }
  };
}

// ################
// Preferences
// ################

export function asAction_showInstructions(show) {
  return { type: SHOW_INSTRUCTIONS, payload: { show } };
}

export function initializePreferences() {
  return async (dispatch, getState) => {
    fetchPreferences().then(preferences => {
      dispatch(
        asAction_showInstructions(
          preferences && preferences.showInstructions
            ? preferences.showInstructions.general
            : true
        )
      );
    });
  };
}

export function hideInstructions() {
  return async (dispatch, getState) => {
    fetchPreferences().then(prefs => {
      prefs.showInstructions = { general: false };
      savePreferences(prefs);
      dispatch(asAction_showInstructions(false));
    });
  };
}

// ################
// Events
// ################

export function saveAllEvents(allEvents) {
  return (dispatch, getState) => {
    saveEvents("default", allEvents);
    dispatch(asAction_setEvents(allEvents));
  };
}

function loadCalendarEvents(calendars) {
  var promises = calendars.map(function(calendar) {
    return importCalendarEvents(calendar, defaultEvents).then(
      events => {
        return { name: calendar.name, events };
      },
      error => {
        console.log("[ERROR.loadCalendarEvents]", error, calendar);
        return { name: calendar.name, events: {} };
      }
    );
  });

  return Promise.all(promises).then(
    allCalendars => {
      return allCalendars.reduce((acc, cur, i) => {
        const events = cur.events;
        return { ...acc, ...events };
      }, {});
    },
    error => {
      return Promise.reject(error);
    }
  );
}

// ################
// Edit Event
// ################

export function deleteEvent(event) {
  return async (dispatch, getState) => {
    let { allEvents } = getState().events;
    delete allEvents[event.uid];
    publishEvents(event.uid, removePublicEvent);
    saveEvents("default", allEvents);
    dispatch(asAction_setEvents(allEvents));
  };
}

export function addEvent(event) {
  return async (dispatch, getState) => {
    let state = getState();
    let { allEvents } = state.events;
    event.calendarName = "default";
    event.uid = uuid();
    allEvents[event.uid] = event;
    saveEvents("default", allEvents);
    if (event.public) {
      publishEvents(event, updatePublicEvent);
    }
    window.history.pushState({}, "OI Calendar", "/");
    delete state.currentEvent;
    delete state.currentEventType;
    dispatch(asAction_setEvents(allEvents));
  };
}

export function updateEvent(event) {
  return async (dispatch, getState) => {
    let { allEvents } = getState().events;
    var eventInfo = event;
    eventInfo.uid = eventInfo.uid || uuid();
    allEvents[eventInfo.uid] = eventInfo;
    if (eventInfo.public) {
      publishEvents(eventInfo, updatePublicEvent);
    } else {
      publishEvents(eventInfo.uid, removePublicEvent);
    }
    saveEvents("default", allEvents);
    dispatch(asAction_setEvents(allEvents));
  };
}

// ################
// Calendars
// ################

export function asAction_showMyPublicCalendar(name, icsUrl) {
  return { type: SHOW_MY_PUBLIC_CALENDAR, payload: { name, icsUrl } };
}

export function showMyPublicCalendar(name) {
  return async dispatch => {
    fetchIcsUrl(name).then(url => {
      console.log("icsurl", url);
      dispatch(asAction_showMyPublicCalendar(name, url));
    });
  };
}

export function asAction_showAllCalendars() {
  return { type: SHOW_ALL_CALENDARS };
}

export function showAllCalendars() {
  return async (dispatch, getState) => {
    window.history.pushState({}, "OI Calendar", "/");
    dispatch(asAction_showAllCalendars());
  };
}
