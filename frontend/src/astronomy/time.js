/**
 * SkyCMD - Zeitumrechnungen (UT, TT, Delta-T)
 *
 * Delta-T nach Espenak & Meeus (NASA / Meeus, Astronomical Algorithms).
 * Die Polynome liefern Delta-T in Sekunden fuer ein dezimales Jahr.
 */

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function dayOfYearUtc(date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
}

export function decimalYearFromDate(date) {
  const year = date.getUTCFullYear();
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const doy = dayOfYearUtc(date);
  const secondsOfDay = date.getUTCHours() * 3600
    + date.getUTCMinutes() * 60
    + date.getUTCSeconds()
    + date.getUTCMilliseconds() / 1000;
  return year + ((doy - 1) + secondsOfDay / 86400) / daysInYear;
}

export function deltaTSecondsFromDecimalYear(year) {
  let t;
  let u;

  if (year < -500) {
    u = (year - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (year < 500) {
    u = year / 100;
    return 10583.6
      - 1014.41 * u
      + 33.78311 * u ** 2
      - 5.952053 * u ** 3
      - 0.1798452 * u ** 4
      + 0.022174192 * u ** 5
      + 0.0090316521 * u ** 6;
  }
  if (year < 1600) {
    u = (year - 1000) / 100;
    return 1574.2
      - 556.01 * u
      + 71.23472 * u ** 2
      + 0.319781 * u ** 3
      - 0.8503463 * u ** 4
      - 0.005050998 * u ** 5
      + 0.0083572073 * u ** 6;
  }
  if (year < 1700) {
    t = year - 1600;
    return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129;
  }
  if (year < 1800) {
    t = year - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000;
  }
  if (year < 1860) {
    t = year - 1800;
    return 13.72
      - 0.332447 * t
      + 0.0068612 * t ** 2
      + 0.0041116 * t ** 3
      - 0.00037436 * t ** 4
      + 0.0000121272 * t ** 5
      - 0.0000001699 * t ** 6
      + 0.000000000875 * t ** 7;
  }
  if (year < 1900) {
    t = year - 1860;
    return 7.62
      + 0.5737 * t
      - 0.251754 * t ** 2
      + 0.01680668 * t ** 3
      - 0.0004473624 * t ** 4
      + t ** 5 / 233174;
  }
  if (year < 1920) {
    t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (year < 1941) {
    t = year - 1920;
    return 21.20 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (year < 1961) {
    t = year - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (year < 1986) {
    t = year - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (year < 2005) {
    t = year - 2000;
    return 63.86
      + 0.3345 * t
      - 0.060374 * t ** 2
      + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4
      + 0.00002373599 * t ** 5;
  }
  if (year < 2050) {
    t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  if (year < 2150) {
    u = (year - 1820) / 100;
    return -20 + 32 * u ** 2 - 0.5628 * (2150 - year);
  }

  u = (year - 1820) / 100;
  return -20 + 32 * u ** 2;
}

export function deltaTSeconds(date) {
  return deltaTSecondsFromDecimalYear(decimalYearFromDate(date));
}

export function julianDayFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function terrestrialTimeFromUniversalTime(utDate) {
  return new Date(utDate.getTime() + deltaTSeconds(utDate) * 1000);
}

export function universalTimeFromTerrestrialTime(ttDate, iterations = 3) {
  let utMillis = ttDate.getTime();
  for (let index = 0; index < iterations; index += 1) {
    const estimate = new Date(utMillis);
    utMillis = ttDate.getTime() - deltaTSeconds(estimate) * 1000;
  }
  return new Date(utMillis);
}

export function gmstHoursFromUt(utDate, longitudeDeg = 0) {
  const jd = julianDayFromDate(utDate);
  const t = (jd - 2451545.0) / 36525.0;
  let gmstDeg = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * t ** 2
    - t ** 3 / 38710000.0;
  gmstDeg = ((gmstDeg % 360) + 360) % 360;
  return (gmstDeg + longitudeDeg) / 15.0;
}

export function buildTimeState(utDate) {
  const ut = new Date(utDate.getTime());
  const deltaT = deltaTSeconds(ut);
  const tt = new Date(ut.getTime() + deltaT * 1000);
  return {
    utDate: ut,
    ttDate: tt,
    deltaTSeconds: deltaT,
    jdUt: julianDayFromDate(ut),
    jdTt: julianDayFromDate(tt),
  };
}