"""Mapped building attributes and conservative estimates for missing dimensions."""
import re


def number(value, default=0):
    feet_inches = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*\"?\s*", str(value or ''))
    if feet_inches:
        return float(feet_inches[1]) * .3048 + float(feet_inches[2]) * .0254
    match = re.search(r'-?\d+(?:\.\d+)?', str(value or ''))
    if not match:
        return default
    value_number = float(match[0])
    return value_number * .3048 if re.search(r"ft|feet|'", str(value)) else value_number


def building_kind(tags, area):
    part = tags.get('building:part')
    building = part if part not in (None, 'yes', 'no') else tags.get('building', '')
    text = ' '.join(str(tags.get(k, '')) for k in ['amenity', 'shop', 'tourism']) + ' ' + building
    if building in ('roof', 'carport', 'porch') or tags.get('building:walls') == 'no': return 'canopy'
    if re.search('church|cathedral|place_of_worship', text): return 'church'
    if re.search('school|civic|public|library|museum|townhall|hospital|university|train_station|fire_station', text): return 'civic'
    if building == 'office' or tags.get('office'): return 'office'
    if re.search('industrial|warehouse|hangar|manufact', text): return 'industrial'
    if re.search('barn|farm|stable|greenhouse', text): return 'farm'
    if re.search('garage|shed', text): return 'shed'
    if re.search('hotel|motel', text): return 'motel'
    if tags.get('shop') or re.search('retail|restaurant|fuel|bank', text): return 'shop'
    if re.search('apartments|dormitory', text): return 'apartment'
    if building in ('house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'static_caravan'): return 'house'
    if building == 'commercial': return 'commercial'
    if building == 'residential': return 'apartment' if area > 500 else 'house'
    zone = tags.get('_landuse')
    if zone in ('commercial', 'retail', 'industrial'): return 'industrial' if zone == 'industrial' else 'commercial'
    return 'house' if area < 500 else 'commercial'


def attributes(tags, area):
    kind = building_kind(tags, area)
    height, levels = number(tags.get('height')), number(tags.get('building:levels'))
    roof_height = number(tags.get('roof:height'))
    mapped = bool(height or levels)
    if not height:
        roof_extra = roof_height or (1.2 if (tags.get('roof:shape') or ('gabled' if kind in ('house','farm') else 'flat')) != 'flat' else 0)
        height = levels * 3.1 + roof_extra if levels else {
            'house':4.5, 'shed':2.8, 'shop':4.8, 'commercial':5.5, 'industrial':7,
            'farm':6, 'motel':4.2, 'apartment':7, 'church':10, 'civic':6, 'office':7,
            'canopy':3.6}.get(kind, 4.5)
    minimum = number(tags.get('min_height')) or number(tags.get('building:min_level')) * 3.1
    return dict(kind=kind, height=round(height, 2), heightSource='mapped' if mapped else 'estimated',
        levels=levels, minLevel=number(tags.get('building:min_level')), minHeight=round(min(minimum, max(0, height-.2)), 2),
        buildingClass=tags.get('building:part') or tags.get('building'),
        part=bool(tags.get('building:part') not in (None, 'no')),
        roof=tags.get('roof:shape') or ('gabled' if kind in ('house', 'farm') else 'flat'),
        roofHeight=roof_height, roofDirection=tags.get('roof:direction'), roofOrientation=tags.get('roof:orientation'),
        material=tags.get('building:material'), roofMaterial=tags.get('roof:material'),
        color=tags.get('building:colour'), roofColor=tags.get('roof:colour'))
