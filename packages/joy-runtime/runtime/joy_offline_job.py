"""Offline candidate compiler. No transport, helper, worker, secrets or device I/O.

Source d7d14 maps absolute M/L/C/Z into records; d6a44 transfers them and0609dc
normalizes internal coordinates. KindCut explicitly owns the schema2 logical
canvas: top-left origin, +X right, +Y down, 72 points/inch. Choosing this contract
does not calibrate the physical machine or recover vendor transform state.
Outputs remain inspection fixtures, NOT authorized packets or a job lifecycle.
"""
import math
import re
from joy_record_transfer import ParserRecord, transfer_records
from joy_point_adapter import batch_body_from_internal
from joy_draw_codec import begin_draw_body, end_draw_body


def _object(value, allowed, required=None):
    if type(value) is not dict or not set(value) <= set(allowed) or not set(allowed if required is None else required) <= set(value):
        raise ValueError('Unexpected or missing object fields.')
    return value


def _number(value):
    if type(value) not in (int, float):
        raise ValueError('Expected finite builtin coordinate/metadata number.')
    try:
        result = float(value)
    except OverflowError:
        raise ValueError('Number exceeds binary64 range.') from None
    if not math.isfinite(result) or abs(result) > 1e6:
        raise ValueError('Nonfinite or excessive coordinate/metadata value.')
    return result


def _uint(value, maximum, minimum=0):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Expected bounded exact integer.')
    return value


def _identifier(value):
    if type(value) is not str or not value.strip() or len(value) > 512:
        raise ValueError('Invalid or excessive identifier.')
    return value


def path_records(steps, *, max_records=100000):
    """Admitted absolute M/L/C/Z; no text grammar or curve flattening.

    Z emits a line record at subpath start only if endpoint differs, matching
    d7d14's normalized closed-path case. It ends the admitted active subpath;
    another drawing command requires M. Repeated Z/relative/implicit forms fail.
    """
    _uint(max_records,100000,1)
    if type(steps) is not list or not 1 <= len(steps) <= max_records:
        raise ValueError('Expected bounded nonempty step list.')
    records = []
    active = False
    drawing = False
    start = current = None
    for raw in steps:
        s = _object(raw,('op','points'))
        op, points = s['op'],s['points']
        if type(op) is not str or op not in ('M','L','C','Z'):
            raise ValueError('Unsupported normalized command.')
        count = 0 if op=='Z' else 3 if op=='C' else 1
        if type(points) is not list or len(points) != count:
            raise ValueError('Wrong command point count.')
        pairs = []
        for raw_point in points:
            p = _object(raw_point,('x','y'))
            pairs.append((_number(p['x']),_number(p['y'])))
        if op=='M':
            start = current = pairs[0]
            active = True
            records.append(ParserRecord(2,*current))
        else:
            if not active:
                raise ValueError('Drawing/close requires active M.')
            if op=='Z':
                if start is None:
                    raise ValueError('Close requires a saved subpath start.')
                if current != start:
                    records.append(ParserRecord(0,*start))
                active = False
            else:
                records.extend(ParserRecord(1 if op=='C' else 0,*pair) for pair in pairs)
                current = pairs[-1]
                drawing = True
        if len(records) > max_records:
            raise ValueError('Parser-record budget exceeded.')
    if not drawing:
        raise ValueError('No drawing geometry.')
    return tuple(records)


def compile_offline_job(plan, *, parser_selector, options_word, batch_limit=56, max_records=100000, group_policies=None):
    """Convert explicit schema2 plans to inert candidate bodies.

    Selectors 0/1 are pen curve routes; selector2 is admitted only through an
    explicit fine-point-blade policy and the source-derived offline kernel.
    """
    if group_policies is None:
        if type(parser_selector) is not int or parser_selector not in (0,1):
            raise ValueError('Only explicit candidate curve selectors0/1 are implemented.')
    elif type(group_policies) is not list or len(group_policies) == 0:
        raise ValueError('Exact group geometry policies required.')
    _uint(options_word,0xffffffff)
    _uint(batch_limit,56,1)
    _uint(max_records,100000,1)
    p = _object(plan,('schemaVersion','coordinateFrame','machine','unit','execution','material','mat','bounds','clipping','groups'))
    if type(p['schemaVersion']) is not int or p['schemaVersion'] != 2 or p['machine'] != 'cricut_joy' or p['unit'] != 'pt72' or p['execution'] != 'unsupported':
        raise ValueError('Unsupported planning envelope.')
    if type(p['coordinateFrame']) is not str or p['coordinateFrame'] != 'kindcut_canvas_pt72_v1':
        raise ValueError('Explicit KindCut canvas frame required; vendor/physical frames unsupported.')
    material = _object(p['material'],('widthIn','heightIn','id'))
    mat = _object(p['mat'],('widthIn','heightIn','mode'),('widthIn','heightIn'))
    if 'mode' in mat and (type(mat['mode']) is not str or mat['mode']!='card' or mat['widthIn']!=4.5 or mat['heightIn']!=6.25):
        raise ValueError('Explicit CardMat mode requires exactly 4.5 by 6.25 inches.')
    material_out = {k:_number(material[k]) for k in ('widthIn','heightIn')}
    material_out['id'] = _uint(material['id'],2**53-1,1)
    mat_out = {k:_number(mat[k]) for k in ('widthIn','heightIn')}
    if not 0 < mat_out['widthIn'] <= 4.5 or not 0 < mat_out['heightIn'] <= 12 or any(not 0 < material_out[k] <= mat_out[k] for k in ('widthIn','heightIn')):
        raise ValueError('Invalid material/mat dimensions.')
    bounds = _object(p['bounds'],('minX','minY','maxX','maxY'))
    bounds_out = {k:_number(bounds[k]) for k in bounds}
    if bounds_out['minX'] > bounds_out['maxX'] or bounds_out['minY'] > bounds_out['maxY']:
        raise ValueError('Reversed bounds.')
    clip = _object(p['clipping'],('policy','clippedPathIds','omittedPathIds'))
    if clip['policy'] not in ('clip','reject'):
        raise ValueError('Unknown clipping policy.')
    clip_out: dict[str, object] = {'policy':clip['policy']}
    for key in ('clippedPathIds','omittedPathIds'):
        if type(clip[key]) is not list or len(clip[key]) > 1000:
            raise ValueError('Invalid clipping report.')
        clip_out[key] = [_identifier(x) for x in clip[key]]
    if type(p['groups']) is not list or not 1 <= len(p['groups']) <= 2:
        raise ValueError('Invalid tool groups.')
    groups, tools, ids = [],set(),set()
    if group_policies is not None and len(group_policies) != len(p['groups']):
        raise ValueError('Geometry policy count must match groups exactly.')
    total = path_count = 0
    for group_index, raw_group in enumerate(p['groups']):
        g = _object(raw_group,('tool','operation','paths'))
        tool, operation = g['tool'],g['operation']
        if type(tool) is not str or tool not in ('pen','fine_point_blade') or tool in tools or operation != ('draw' if tool=='pen' else 'cut'):
            raise ValueError('Unsupported or duplicate tool/operation.')
        tools.add(tool)
        policy = group_policies[group_index] if group_policies is not None else None
        if policy is not None:
            expected = (4,2,1,4) if tool == 'pen' else (2,1,2,2)
            if (getattr(policy,'native_tool_type',None), getattr(policy,'native_art_type',None), getattr(policy,'parser_selector',None), getattr(policy,'parser_options_word',None)) != expected:
                raise ValueError('Geometry policy does not match selected tool route.')
        group_selector = parser_selector if policy is None else policy.parser_selector
        group_options = options_word if policy is None else policy.parser_options_word
        if type(g['paths']) is not list or not 1 <= len(g['paths']) <= 1000:
            raise ValueError('Invalid path list.')
        paths = []
        for raw_path in g['paths']:
            path = _object(raw_path,('id','color','steps'),('id','steps'))
            ident = _identifier(path['id'])
            if ident in ids:
                raise ValueError('Duplicate path identifier.')
            ids.add(ident)
            path_count += 1
            if path_count > 1000:
                raise ValueError('Job path budget exceeded.')
            color = path.get('color')
            if (tool=='pen' or 'color' in path) and (type(color) is not str or re.fullmatch(r'#[a-fA-F0-9]{6}',color) is None):
                raise ValueError('Invalid/missing path color.')
            source_steps = path['steps']
            if tool == 'fine_point_blade':
                if policy is None:
                    raise ValueError('Blade geometry requires an explicit selector2 tool policy.')
                from joy_blade_geometry import offset_path
                geometry = offset_path(source_steps, offset=policy.offset_internal,
                    options_word=group_options, max_source_records=max_records, max_output_records=max_records)
                parser = tuple(ParserRecord(record.kind, record.x, record.y)
                    for subpath in geometry.paths for record in subpath.records)
                if not parser or len(parser) > max_records:
                    raise ValueError('Blade geometry record budget exceeded.')
                # Plan.bounds describes the SOURCE geometry, not allowable travel.
                # Knife compensation must expand that envelope while still fitting
                # the explicit logical material rectangle. No physical limit claim.
                if any(not 0 <= record.x <= material_out['widthIn']*72 or
                       not 0 <= record.y <= material_out['heightIn']*72 for record in parser):
                    raise ValueError('Compensated blade path exceeds material bounds; clipping is unsupported.')
                bounds_out = {'minX':min(bounds_out['minX'],*(r.x for r in parser)),
                              'minY':min(bounds_out['minY'],*(r.y for r in parser)),
                              'maxX':max(bounds_out['maxX'],*(r.x for r in parser)),
                              'maxY':max(bounds_out['maxY'],*(r.y for r in parser))}
            else:
                parser = path_records(source_steps,max_records=max_records)
            points = transfer_records(parser,options_word=group_options,max_records=max_records)
            total += len(points)
            if total > max_records:
                raise ValueError('Whole-job transferred-record budget exceeded.')
            bodies = [batch_body_from_internal(points[i:i+batch_limit],max_points=batch_limit).hex() for i in range(0,len(points),batch_limit)]
            entry = {'id':ident,'pointRecordCount':len(points),'pointKinds':[point.kind_bits for point in points],'batchBodiesHex':bodies}
            if color is not None:
                entry['color'] = color
            paths.append(entry)
        groups.append({'tool':tool,'operation':operation,'strategy':{'parserSelector':group_selector,'optionsWord':group_options},'paths':paths})
    primary_selector = group_policies[0].parser_selector if group_policies is not None else parser_selector
    primary_options = group_policies[0].parser_options_word if group_policies is not None else options_word
    return {'schemaVersion':1,'kind':'native_joy_offline_candidate','machine':'cricut_joy',
        'execution':'unsupported','safetyValidated':False,'configurationValidated':False,
        'coordinateMapping':'kindcut_canvas_pt72_v1',
        'coordinateFrame':{'id':'kindcut_canvas_pt72_v1',
            'origin':'logical_canvas_top_left','xAxis':'right','yAxis':'down',
            'pointsPerInch':72,'nativeProjection':'pt72_divided_by_72',
            'physicalOrigin':'unverified','physicalAxes':'unverified',
            'vendorTransformStateUsed':False},
        'batching':'fixed_offline_chunks_not_live_flow_control',
        'strategy':{'parserSelector':primary_selector,'optionsWord':primary_options,'batchLimit':batch_limit},
        'bodyTemplates':{'beginDraw':begin_draw_body().hex(),'endDraw':end_draw_body().hex()},
        'material':material_out,'mat':mat_out,'bounds':bounds_out,'clipping':clip_out,
        'pointRecordCount':total,'groups':groups,
        'unresolved':['physical_axes_origin_and_tool_configuration','effective_runtime_strategy',
                      'full_job_lifecycle_and_live_flow_control','physical_ready_stop_and_completion']}
