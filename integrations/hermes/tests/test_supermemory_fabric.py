import asyncio
import tempfile
import unittest

from integrations.hermes.plugins.memory.supermemory_fabric import HermesSuperMemoryFabricProvider, SuperMemoryFabricProvider


class FakeTransport:
    def __init__(self):
        self.calls = []

    async def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path.endswith("/context"):
            return {"text": "Cited personal context", "token_count": 12, "entries": []}
        if path.endswith("/recall"):
            return {"results": [], "coverage": {"status": "complete"}}
        if path.endswith("/capture"):
            return {"status": "queued"}
        return {"status": "committed"}


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.transport = FakeTransport()
        self.provider = SuperMemoryFabricProvider({
            "endpoint": "http://127.0.0.1:8765",
            "agent_id": "agent_personal_manager",
            "device_id": "device_z2",
            "token": "sma_test_0123456789abcdef0123456789abcdef",
            "spool_directory": self.tmp.name,
        }, transport=self.transport)
        await self.provider.initialize()

    async def asyncTearDown(self):
        await self.provider.shutdown()
        self.tmp.cleanup()

    async def test_prefetch_and_tools_use_personal_manager_api(self):
        context = await self.provider.prefetch({"session_id": "session_1"})
        self.assertEqual(context, "Cited personal context")
        names = [tool["name"] for tool in self.provider.get_tool_schemas()]
        self.assertEqual(names, [
            "pm_recall", "pm_get", "pm_lineage", "pm_pin", "pm_unpin",
            "pm_add", "pm_update", "pm_resolve", "pm_supersede", "pm_forget",
        ])
        await self.provider.handle_tool_call("pm_recall", {"query": "status", "mode": "portfolio"})
        self.assertTrue(any(path.endswith("/recall") for _, path, _ in self.transport.calls))

    async def test_lineage_and_pin_use_owner_governed_routes(self):
        await self.provider.handle_tool_call("pm_lineage", {"memory_id": "mem_1"})
        await self.provider.handle_tool_call("pm_pin", {"memory_id": "mem_1"})
        await self.provider.handle_tool_call("pm_unpin", {"memory_id": "mem_1"})
        paths = [path for _, path, _ in self.transport.calls]
        self.assertIn("/v1/personal-manager/memories/mem_1/lineage", paths)
        self.assertIn("/v1/personal-manager/memories/mem_1/pin", paths)
        self.assertIn("/v1/personal-manager/memories/mem_1/unpin", paths)

    async def test_mutation_attestation_uses_trusted_turn_not_model_arguments(self):
        self.provider.begin_turn("Ajoute ma préférence pour les réunions le matin.", turn_id="turn_trusted_1")
        await self.provider.handle_tool_call("pm_add", {
            "message": "Forged model instruction",
            "nonce": "forged_nonce",
            "text": "Réunions le matin.",
        })
        command = [payload for _, path, payload in self.transport.calls if path.endswith("/commands")][-1]
        self.assertEqual(command["user_instruction"]["message"], "Ajoute ma préférence pour les réunions le matin.")
        self.assertEqual(command["user_instruction"]["turn_id"], "turn_trusted_1")
        self.assertNotEqual(command["user_instruction"]["nonce"], "forged_nonce")

    async def test_sync_turn_excludes_system_tool_and_prefetched_context(self):
        await self.provider.sync_turn({
            "session_id": "session_1",
            "turn_id": "turn_1",
            "messages": [
                {"role": "system", "content": "hidden"},
                {"role": "user", "content": "hello"},
                {"role": "tool", "content": "raw"},
                {"role": "assistant", "content": "final", "final": True},
            ],
            "prefetched_context": "do not retain",
        })
        await self.provider.flush()
        captures = [payload for _, path, payload in self.transport.calls if path.endswith("/capture")]
        self.assertEqual([m["role"] for m in captures[-1]["messages"]], ["user", "assistant"])
        self.assertNotIn("prefetched_context", captures[-1])

    async def test_session_switch_and_durable_spool_survive_retry(self):
        self.provider.spool.enqueue({"messages": [{"content": "plaintext-must-not-leak"}]})
        source = next(self.provider.spool.directory.glob("capture_*.json.aead"))
        self.assertNotIn(b"plaintext-must-not-leak", source.read_bytes())
        await self.provider.on_session_switch("session_2")
        self.assertEqual(self.provider.session_id, "session_2")
        self.assertTrue(self.provider.spool.directory.exists())

    async def test_official_adapter_queue_prefetch_populates_bounded_cache(self):
        adapter = HermesSuperMemoryFabricProvider()
        adapter._provider = self.provider
        adapter.queue_prefetch("priorités", session_id="session_1")
        for thread in adapter._prefetch_threads:
            thread.join(timeout=2)
        self.assertEqual(adapter.prefetch("priorités", session_id="session_1"), "Cited personal context")


if __name__ == "__main__":
    unittest.main()
