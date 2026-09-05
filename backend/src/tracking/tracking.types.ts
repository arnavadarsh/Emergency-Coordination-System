/**
 * Shapes returned by the public tracking endpoint.
 *
 * Everything here is deliberately anonymous. The link is unauthenticated, so
 * whatever appears in these types is visible to anyone the patient (or their
 * emergency contacts) forwards it to: the ambulance, the route, the stage and
 * the receiving hospital — never the patient's name, contact details, triage
 * answers, severity or medical profile.
 */

export type TrackingStageCode =
  | 'ASSIGNED'
  | 'EN_ROUTE_PICKUP'
  | 'AT_PICKUP'
  | 'EN_ROUTE_HOSPITAL'
  | 'AT_HOSPITAL';

export interface TrackingStage {
  code: TrackingStageCode;
  /** Short label for the page header, e.g. "On the way to the patient". */
  label: string;
  /** One line of reassurance explaining what is happening right now. */
  description: string;
  /** 1-based position in the five-stage progress rail. */
  step: number;
  totalSteps: number;
}

export interface TrackingPoint {
  latitude: number;
  longitude: number;
}

export interface PublicTrackingView {
  /** Short human-quotable case reference. Not the booking id. */
  caseReference: string;
  stage: TrackingStage;
  ambulance: {
    vehicleNumber: string | null;
    location: TrackingPoint | null;
    locationUpdatedAt: string | null;
  };
  /** Where the ambulance is heading right now — the patient first, then hospital. */
  target: (TrackingPoint & { kind: 'PICKUP' | 'HOSPITAL'; label: string }) | null;
  hospital: {
    name: string;
    address: string | null;
    location: TrackingPoint | null;
  } | null;
  eta: {
    minutes: number | null;
    text: string;
    expectedArrivalIso: string | null;
    /** What the ETA counts down to, e.g. "Reaching the patient". */
    label: string;
  };
  timeline: {
    assignedAt: string | null;
    arrivedAtPickupAt: string | null;
    departedPickupAt: string | null;
    arrivedAtHospitalAt: string | null;
  };
  /** Server time this view was built, so the page can show "updated 3s ago". */
  updatedAt: string;
}

/** Body of the 410 returned once a case is over. */
export interface ClosedTrackingView {
  statusCode: 410;
  status: 'ENDED';
  reason: 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'REVOKED';
  message: string;
  /** Only for a completed case: where the patient was taken. */
  hospitalName?: string | null;
}
