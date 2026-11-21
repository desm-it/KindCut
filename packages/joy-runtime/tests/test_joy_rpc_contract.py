import unittest
from joy_rpc_contract import load_vectors, validate_job_request

class JobRpcContractTests(unittest.TestCase):
    def test_shared_vectors(self):
        vectors=load_vectors()
        for value in vectors['accepted']: self.assertTrue(validate_job_request(value), value)
        for value in vectors['rejected']: self.assertFalse(validate_job_request(value), value)

    def test_exact_keys_and_booleans(self):
        value=load_vectors()['accepted'][0]
        self.assertFalse(validate_job_request({**value,'extra':True}))
        self.assertFalse(validate_job_request({**value,'motionApproved':1}))

if __name__ == '__main__': unittest.main()
