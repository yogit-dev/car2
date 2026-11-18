/**
 * VehicleSpecs.js — everything that makes a car, a bike and a bus different, as plain data (no Three.js, so
 * the physics tests can import it in Node).
 *
 *   physics   overrides for Vehicle's parameters ({} = the car defaults that live in Vehicle.js)
 *   mapping   overrides for Controls.js (how much body movement = full steering lock, how heavy it feels)
 *   body      how the model pitches (squat/dive) and rolls (lean) under acceleration / cornering
 *   chase     chase-camera placement
 *   wheelSteerVisual   how much the front wheels are turned on screen, relative to the real steering angle
 *
 * To add a vehicle: add an entry here, write a build function in Models.js with the same return shape as
 * buildCar(), and register it in Simulator.js (BUILDERS).
 */
export const VEHICLE_TYPES = ['car', 'bike', 'bus'];

export const VEHICLES = {
  car: {
    label: 'Car',
    blurb: 'Balanced and easy to drive',
    physics: {},
    mapping: {},
    body: { pitchK: 0.0035, pitchMax: 0.05, rollK: 0.0028, rollMax: 0.06 },
    chase: { back: 7.6, height: 2.9, lookAhead: 10, lookHeight: 1.15 },
    wheelSteerVisual: 1.6,
  },

  // A motorbike: light and quick, very agile, leans into corners. (Same right-foot throttle/brake.)
  bike: {
    label: 'Bike',
    blurb: 'Light, fast and twitchy — leans into bends',
    physics: {
      mass: 210, wheelBase: 1.4, wheelRadius: 0.32, finalDrive: 3.0,
      gears: [2.6, 1.9, 1.5, 1.25, 1.05, 0.92],
      peakTorque: 56, dragCoef: 0.25, rolling: 0.016,
      brakeForce: 2000, tractionLimit: 1440, gripG: 1.05,   // sticky sport tyres
      maxSteerAngle: 0.26,      // short wheelbase: less lock than a car, yet a tighter turning circle
    },
    mapping: { steerTiltDeg: 28, steerRate: 18 },
    body: { pitchK: 0.006, pitchMax: 0.1, rollK: -0.05, rollMax: 0.62 },   // negative roll = lean INTO the turn
    chase: { back: 5.2, height: 2.2, lookAhead: 10, lookHeight: 1.0 },
    wheelSteerVisual: 1.6,
  },

  // A city bus: heavy, slow to speed up, long brake distance, wide turning circle.
  bus: {
    label: 'Bus',
    blurb: 'Heavy and steady — plan your braking',
    physics: {
      mass: 12000, wheelBase: 5.9, wheelRadius: 0.5, finalDrive: 5.2,
      gears: [3.9, 2.6, 1.8, 1.3, 1.0, 0.8],
      peakTorque: 380, dragCoef: 4.3, rolling: 0.008,
      brakeForce: 62000, tractionLimit: 45000, gripG: 0.45,
      maxSteerAngle: 0.42,
    },
    mapping: { steerTiltDeg: 48, steerRate: 8, pedalRate: 12 },
    body: { pitchK: 0.0003, pitchMax: 0.03, rollK: 0.0014, rollMax: 0.035 },
    chase: { back: 13, height: 5.4, lookAhead: 14, lookHeight: 1.8 },
    wheelSteerVisual: 1.6,
  },
};

export const DEFAULT_VEHICLE = 'car';
export const isVehicleType = (t) => Object.prototype.hasOwnProperty.call(VEHICLES, t);
