"""Golden native configuration projection, not firmware/safety equivalence."""
import struct
import unittest
import test_joy_tool_configuration as fixture
from test_joy_offline_job import plan


class ConfigurationBodyTests(unittest.TestCase):
    def module(self):
        return fixture.ConfiguredCandidateTests().module()

    def config(self):
        return fixture.ConfiguredCandidateTests().config()

    def bodies(self, p=None, c=None):
        r = self.module().compile_configured_candidate(plan() if p is None else p,
                                                       self.config() if c is None else c)
        return r, [bytes.fromhex(x['bodyHex']) for x in r['configurationBodyTemplates']]

    def test_settings_reach_real_machine_speed_and_geometry_body_bytes(self):
        c = self.config()
        for key, values in zip(('cutVelocity_ips', 'moveVelocity_ips',
                                'cutAcceleration_ips2', 'moveAcceleration_ips2'),
                               ([1, 2], [3, 4], [5, 6], [7, 8])):
            c['speeds'][key] = values
        r, (machine, speed, geometry) = self.bodies(c=c)
        self.assertEqual(machine, bytes.fromhex('30880000050c000000000200a0'))
        self.assertEqual(speed[:6], bytes([0x31]) + bytes([15]) * 5)
        expected = [1, 2, 9, 10, 11, 3, 4, 12, 13, 14, 5, 6, 15, 16, 17, 7, 8, 18, 19, 20]
        self.assertEqual(struct.unpack('>20H', speed[6:]), tuple(v * 100 for v in expected))
        flags = (1 << 4) | (1 << 6) | (1 << 3) | (1 << 2) | (1 << 1) | 1
        self.assertEqual(geometry, bytes([0x3e, 0, flags]) + struct.pack('>fff', 1, 2, 3) + bytes([1, 2, 3, 4, 5]))
        self.assertEqual(r['effectiveConfiguration']['positionCounts'], 160)
        self.assertEqual(r['effectiveConfiguration']['provenance'], 'caller_supplied_unverified')
        self.assertEqual(r['coordinateFrame']['physicalAxes'], 'unverified')
        self.assertEqual(r['execution'], 'unsupported')

    def test_each_native_compensation_flag_has_its_own_verified_wire_bit(self):
        cases = [('p_bias_enabled', 4), ('roc_threshold_enabled', 6),
                 ('t_bias_enabled', 3), ('use_calc_offsets', 2),
                 ('centered_bl', 1), ('tan_theta', 0)]
        for name, bit in cases:
            c = self.config()
            c['geometry']['flags'] = {key: key == name for key, _ in cases}
            _, bodies = self.bodies(c=c)
            with self.subTest(name=name):
                self.assertEqual(bodies[2][2], 1 << bit)

    def test_native_speed_fcvtas_is_round_nearest_half_away_not_truncation(self):
        c = self.config(); c['speeds']['cutVelocity_ips'][0] = .125
        _, bodies = self.bodies(c=c)
        self.assertEqual(struct.unpack('>H', bodies[1][6:8])[0], 13)
        c['speeds']['cutVelocity_ips'][0] = .124
        _, bodies = self.bodies(c=c)
        self.assertEqual(struct.unpack('>H', bodies[1][6:8])[0], 12)

    def test_ordinary_profile_minimum_height_is_twelve_even_for_short_mat(self):
        p = plan(); p['mat']['heightIn'] = 6.5
        _, bodies = self.bodies(p=p)
        # 04772c clamps the machine-profile dimension to >=12 before 05168c;
        # the separate 0x11 mat dimension is still 6.5 and is not rewritten.
        self.assertEqual(bodies[0][5], 12)

    def test_all_nonxy_and_geometry_values_are_required_not_defaulted(self):
        for key in ('nonXY', 'geometry'):
            c = self.config(); del c[key]
            with self.subTest(key=key), self.assertRaises(ValueError): self.bodies(c=c)
        c = self.config(); c['nonXY'].pop('moveVelocity')
        with self.assertRaises(ValueError): self.bodies(c=c)

    def test_serialize_bounds_and_geometry_types_are_strict(self):
        for change in (lambda c: c['geometry']['flags'].update(p_bias_enabled=1),
                       lambda c: c['geometry']['flags'].update(blade_down=True),
                       lambda c: c['geometry'].update(lift_threshold=float('inf')),
                       lambda c: c['geometry'].update(nodes=[0, 0, 0, 0, 256]),
                       lambda c: c['nonXY']['moveVelocity'].__setitem__(1, 655.36),
                       lambda c: c['speeds']['cutVelocity_ips'].__setitem__(0, 0),
                       lambda c: c['speeds']['cutVelocity_ips'].__setitem__(0, 10 ** 500)):
            c = self.config(); change(c)
            with self.assertRaises(ValueError): self.bodies(c=c)

    def test_real_configured_caller_preserves_frame_rejection(self):
        for change in (lambda p: p.pop('coordinateFrame'), lambda p: p.update(schemaVersion=1),
                       lambda p: p.update(coordinateFrame='vendor_current')):
            p = plan(); change(p)
            with self.assertRaises(ValueError): self.bodies(p=p)
