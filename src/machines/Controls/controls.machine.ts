import { send, assign, createMachine, forwardTo as fwdTo } from "xstate";
import type { ControlsContext, ControlsEvent } from "./controls.types";
import type { MouseAxisInputConfig } from "../configuration/configuration.types";
import { keyboardHandlerService, mouseHandlerService } from "./services";
import {
  handleMouseMove,
  inputEventHandler,
  keyboardAxisHandler,
  keyboardActionHandler,
} from "./actions";

import { InputsConfiguration } from "../configuration/InputsConfiguration";
import { isEventType } from "../functions";

export const createControlsMachine = <
  Axis extends string,
  Actions extends string,
  Configuration extends InputsConfiguration<Axis, Actions> = InputsConfiguration<Axis, Actions>,
>(
  // for now these are just used for typing enforcing and required.
  // we'll put them to use soon enough.
  axis: readonly Axis[],
  actions: readonly Actions[],
  config: Configuration
) => {
  const mouseInputs = config.getAllBindings().filter((binding) => binding.controller === "mouse");
  function getMouseAxis(a: "x" | "y") {
    return mouseInputs.find(
      (i) => i.inputs.includes(a) && i.mode === "analog" && i.deadzone
      // )?.ref as Names;
    ) as MouseAxisInputConfig;
  }

  const getInitialValues = () => {
    return config.refs.reduce((p, key) => ({ ...p, [key]: 0 }), {}) as {
      [k in Axis | Actions]: number;
    };
  };

  const getMouseAxisObject = () => ({
    x: getMouseAxis("x"),
    y: getMouseAxis("y"),
  });

  const setAllControllersState = (value: boolean) =>
    config.controllers.reduce((p, v) => ({ ...p, [v]: value }), {});

  // Setup initial context
  const initialContext: ControlsContext<Configuration, Axis, Actions> = {
    config,
    values: getInitialValues(),
    // controllers enabled by the configuration.
    // we could use these to either toggle individual controllers if needed
    // or to validate configuration against this machine (i.e. check if we can
    // handle certain types of controllers or input types)
    controllers: setAllControllersState(true),
    mouseAxis: getMouseAxisObject(),
  };

  // type safe closure for dev sanity
  const forwardTo = (...args: Parameters<typeof fwdTo>) => fwdTo<ControlsContext<Configuration, Axis, Actions>,ControlsEvent<Configuration, Axis, Actions>>(...args);

  const toggleAllControllers = (value: boolean) =>
    config.controllers.map(controller => send({type: "TOGGLE_CONTROLLER", controller, value}, { to: controller }))

  return createMachine(
    {
      predictableActionArguments: true,
      tsTypes: {} as import("./controls.machine.typegen").Typegen0,
      context: initialContext,
      initial: "inactive",
      id: "input-controller",
      schema: {
        context: {} as ControlsContext<Configuration, Axis, Actions>,
        events: {} as ControlsEvent<Configuration, Axis, Actions>,
      },
      entry: ["_setupMouseAxis"],
      invoke: [
        { id: "keyboard", src: "keyboardHandlerService" },
        { id: "mouse", src: "mouseHandlerService" },
      ],
      on: {
        CONTROLLER_STATUS_CHANGED: {
            actions: ["updateControllerStatus"]
        }
      },
      states: {
        inactive: {
          entry: ["_resetValues",],
          on: {
            START: "active"
          },
        },
        active: {
          /* notify each service that they need to start/stop completely */
          entry: toggleAllControllers(true),
          exit: toggleAllControllers(false),
          // @ts-ignore -- forwardTo isn't working properly for TS but it works fine
          on: {
            INPUT_RECEIVED: {
              actions: ["onKeyboardAxisReceived", "onKeyboardActionReceived"],
            },
            MOUSE_MOVED: {
              actions: ["onMouseAxisReceived"],
            },
            TOGGLE_CONTROLLER: {
              actions: [
                forwardTo('keyboard'),
                forwardTo('mouse')
              ],
            },
            STOP: "inactive",
          },
        },
      },
    },
    {
      services: {
        keyboardHandlerService,
        mouseHandlerService,
      },
      actions: {
        onKeyboardAxisReceived: assign(inputEventHandler<Configuration, Axis, Actions>("axis", keyboardAxisHandler)),
        onKeyboardActionReceived: assign(inputEventHandler<Configuration, Axis, Actions>("action", keyboardActionHandler)),
        onMouseAxisReceived: assign(handleMouseMove<Configuration, Axis, Actions>()),

        // internals -------------------------------------------------------------------

        updateControllerStatus: assign((ctx, event) => {
          if (!isEventType(event, "CONTROLLER_STATUS_CHANGED")) return {};
          // console.info('🎮 inputs toggled', event)
          const controllers = { ...ctx.controllers, [event.controller]: event.status } as typeof ctx.controllers;
          // check if there's at least one active listener. if not send a STOP message
          const active = Object.values(controllers).some(v => v === true);
          if (!active) send({ type: 'STOP' })
          return { controllers };
        }),
        _resetValues: assign({ values: getInitialValues() }),
        _setupMouseAxis: assign({ mouseAxis: getMouseAxisObject() }),
      },
    }
  );
};

