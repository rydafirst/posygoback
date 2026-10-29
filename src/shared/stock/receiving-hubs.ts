export interface ReceivingHubView {
  warehouseId: string;
  label: string;
  city: string;
  area: string;
  unitsHeld: number;
}

interface HubPlace {
  city: string;
  postalCode: string;
}

export function hubArea(postalCode: string): string {
  const compact = postalCode.trim().toUpperCase();
  const [outward] = compact.split(/\s+/);
  return outward && outward !== compact ? outward : compact.slice(0, Math.max(3, compact.length - 3));
}

export function hubLabels(hubs: readonly HubPlace[]): string[] {
  const named = hubs.map((hub) => {
    const sharesCity = hubs.filter((other) => other.city === hub.city).length > 1;
    return sharesCity ? `${hub.city} ${hubArea(hub.postalCode)}` : hub.city;
  });
  return named.map((label, index) => {
    const twins = named.filter((other) => other === label).length;
    return twins > 1 ? `${label} (${named.slice(0, index + 1).filter((other) => other === label).length})` : label;
  });
}
